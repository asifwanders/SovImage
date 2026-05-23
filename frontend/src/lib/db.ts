"use client";

import type {
  Chat,
  Message,
  MessageKind,
  MessageRole,
  MessageStatus,
  SearchHit,
} from "./types";

// ---------------------------------------------------------------------------
// Thin DB facade over `@tauri-apps/plugin-sql`. In a browser-dev (`next dev`)
// session without Tauri, falls back to an in-memory store so the UI is fully
// usable. The Tauri runtime registers migrations on its side; loading the DB
// from JS triggers them automatically.
//
// The connection URL string MUST match `db::DB_URL` in src-tauri.
// ---------------------------------------------------------------------------

const DB_URL = "sqlite:sovimage.db";

interface Driver {
  chatsList(): Promise<Chat[]>;
  chatsCreate(title: string): Promise<Chat>;
  chatsRename(id: string, title: string): Promise<void>;
  chatsDelete(id: string): Promise<void>;
  messagesList(chatId: string): Promise<Message[]>;
  messagesAppend(input: {
    chatId: string;
    role: MessageRole;
    kind: MessageKind;
    content: string | null;
    parentId: string | null;
    status?: MessageStatus;
    imagePath?: string | null;
  }): Promise<Message>;
  messageUpdate(
    id: string,
    patch: Partial<Pick<Message, "status" | "imagePath" | "content">>,
  ): Promise<void>;
  search(query: string): Promise<SearchHit[]>;
  settingGet(key: string): Promise<string | null>;
  settingSet(key: string, value: string): Promise<void>;
}

let driverPromise: Promise<Driver> | null = null;

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function db(): Promise<Driver> {
  if (!driverPromise) {
    driverPromise = isTauri() ? sqliteDriver() : Promise.resolve(memoryDriver());
  }
  return driverPromise;
}

function uid() {
  return crypto.randomUUID();
}
function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// SQLite driver — used inside Tauri.
// ---------------------------------------------------------------------------

async function sqliteDriver(): Promise<Driver> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const sql = await Database.load(DB_URL);
  // Per-connection PRAGMAs (cannot run inside the migration transaction).
  await sql.execute("PRAGMA journal_mode = WAL");
  await sql.execute("PRAGMA foreign_keys = ON");

  type ChatRow = {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    pinned: number;
    archived: number;
  };
  type MsgRow = {
    id: string;
    chat_id: string;
    role: string;
    kind: string;
    content: string | null;
    image_path: string | null;
    meta_json: string | null;
    parent_id: string | null;
    status: string;
    created_at: string;
  };
  const rowToChat = (r: ChatRow): Chat => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pinned: !!r.pinned,
    archived: !!r.archived,
  });
  const rowToMsg = (r: MsgRow): Message => ({
    id: r.id,
    chatId: r.chat_id,
    role: r.role as MessageRole,
    kind: r.kind as MessageKind,
    content: r.content,
    imagePath: r.image_path,
    meta: r.meta_json ? JSON.parse(r.meta_json) : null,
    parentId: r.parent_id,
    status: r.status as MessageStatus,
    createdAt: r.created_at,
  });

  return {
    async chatsList() {
      const rows = await sql.select<ChatRow[]>(
        "SELECT id, title, created_at, updated_at, pinned, archived FROM chats WHERE archived = 0 ORDER BY pinned DESC, updated_at DESC",
      );
      return rows.map(rowToChat);
    },
    async chatsCreate(title) {
      const id = uid();
      const ts = now();
      await sql.execute(
        "INSERT INTO chats (id, title, created_at, updated_at, pinned, archived) VALUES ($1, $2, $3, $3, 0, 0)",
        [id, title, ts],
      );
      return {
        id,
        title,
        createdAt: ts,
        updatedAt: ts,
        pinned: false,
        archived: false,
      };
    },
    async chatsRename(id, title) {
      await sql.execute(
        "UPDATE chats SET title = $1, updated_at = $2 WHERE id = $3",
        [title, now(), id],
      );
    },
    async chatsDelete(id) {
      await sql.execute("DELETE FROM chats WHERE id = $1", [id]);
    },
    async messagesList(chatId) {
      const rows = await sql.select<MsgRow[]>(
        "SELECT id, chat_id, role, kind, content, image_path, meta_json, parent_id, status, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at",
        [chatId],
      );
      return rows.map(rowToMsg);
    },
    async messagesAppend(input) {
      const id = uid();
      const ts = now();
      const status = input.status ?? (input.role === "assistant" ? "pending" : "done");
      await sql.execute(
        "INSERT INTO messages (id, chat_id, role, kind, content, image_path, meta_json, parent_id, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9)",
        [
          id,
          input.chatId,
          input.role,
          input.kind,
          input.content,
          input.imagePath ?? null,
          input.parentId,
          status,
          ts,
        ],
      );
      await sql.execute(
        "UPDATE chats SET updated_at = $1 WHERE id = $2",
        [ts, input.chatId],
      );
      return {
        id,
        chatId: input.chatId,
        role: input.role,
        kind: input.kind,
        content: input.content,
        imagePath: input.imagePath ?? null,
        meta: null,
        parentId: input.parentId,
        status,
        createdAt: ts,
      };
    },
    async messageUpdate(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.status !== undefined) {
        sets.push(`status = $${params.length + 1}`);
        params.push(patch.status);
      }
      if (patch.imagePath !== undefined) {
        sets.push(`image_path = $${params.length + 1}`);
        params.push(patch.imagePath);
      }
      if (patch.content !== undefined) {
        sets.push(`content = $${params.length + 1}`);
        params.push(patch.content);
      }
      if (sets.length === 0) return;
      params.push(id);
      await sql.execute(
        `UPDATE messages SET ${sets.join(", ")} WHERE id = $${params.length}`,
        params,
      );
    },
    async search(query) {
      type Hit = { message_id: string; chat_id: string; snippet: string };
      const rows = await sql.select<Hit[]>(
        "SELECT message_id, chat_id, snippet(messages_fts, 0, '<b>', '</b>', '…', 16) AS snippet FROM messages_fts WHERE messages_fts MATCH $1 LIMIT 50",
        [query],
      );
      return rows.map((r) => ({
        messageId: r.message_id,
        chatId: r.chat_id,
        snippet: r.snippet,
      }));
    },
    async settingGet(key) {
      const rows = await sql.select<{ value: string }[]>(
        "SELECT value FROM settings WHERE key = $1",
        [key],
      );
      return rows[0]?.value ?? null;
    },
    async settingSet(key, value) {
      await sql.execute(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Memory driver — used in browser-dev mode so `next dev` is still usable.
// ---------------------------------------------------------------------------

function memoryDriver(): Driver {
  const chats: Chat[] = [];
  const messages: Record<string, Message[]> = {};
  const settings: Record<string, string> = {};

  return {
    async chatsList() {
      return [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async chatsCreate(title) {
      const c: Chat = {
        id: uid(),
        title,
        createdAt: now(),
        updatedAt: now(),
        pinned: false,
        archived: false,
      };
      chats.unshift(c);
      messages[c.id] = [];
      return c;
    },
    async chatsRename(id, title) {
      const c = chats.find((x) => x.id === id);
      if (c) {
        c.title = title;
        c.updatedAt = now();
      }
    },
    async chatsDelete(id) {
      const i = chats.findIndex((x) => x.id === id);
      if (i >= 0) chats.splice(i, 1);
      delete messages[id];
    },
    async messagesList(chatId) {
      return messages[chatId] ?? [];
    },
    async messagesAppend(input) {
      const m: Message = {
        id: uid(),
        chatId: input.chatId,
        role: input.role,
        kind: input.kind,
        content: input.content,
        imagePath: input.imagePath ?? null,
        meta: null,
        parentId: input.parentId,
        status:
          input.status ?? (input.role === "assistant" ? "pending" : "done"),
        createdAt: now(),
      };
      messages[input.chatId] = messages[input.chatId] ?? [];
      messages[input.chatId].push(m);
      const chat = chats.find((c) => c.id === input.chatId);
      if (chat) chat.updatedAt = now();
      return m;
    },
    async messageUpdate(id, patch) {
      for (const list of Object.values(messages)) {
        const m = list.find((x) => x.id === id);
        if (m) {
          if (patch.status !== undefined) m.status = patch.status;
          if (patch.imagePath !== undefined) m.imagePath = patch.imagePath;
          if (patch.content !== undefined) m.content = patch.content;
          return;
        }
      }
    },
    async search() {
      return [];
    },
    async settingGet(key) {
      return settings[key] ?? null;
    },
    async settingSet(key, value) {
      settings[key] = value;
    },
  };
}

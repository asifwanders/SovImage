"use client";

import type {
  Chat,
  Message,
  MessageKind,
  MessageRole,
  MessageStatus,
  SearchHit,
  GenerationMeta,
} from "./types";
import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  toFtsPhrase,
} from "./search";

// ---------------------------------------------------------------------------
// Thin DB facade over `@tauri-apps/plugin-sql`. In a browser-dev (`next dev`)
// session without Tauri, falls back to an in-memory store so the UI is fully
// usable. The Tauri runtime registers migrations on its side; loading the DB
// from JS triggers them automatically.
//
// The connection URL string MUST match `db::DB_URL` in src-tauri.
// ---------------------------------------------------------------------------

const DB_URL = "sqlite:sovimage.db";

export interface MediaPathMapping {
  from: string;
  to: string;
}

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
    patch: Partial<
      Pick<Message, "status" | "imagePath" | "content" | "kind" | "meta">
    >,
  ): Promise<void>;
  reconcileInterrupted(): Promise<number>;
  clearAll(resetSettings: boolean): Promise<void>;
  migrateMediaPaths(mappings: MediaPathMapping[]): Promise<number>;
  referencedFiles(): Promise<string[]>;
  search(query: string): Promise<SearchHit[]>;
}

let driverPromise: Promise<Driver> | null = null;

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function db(): Promise<Driver> {
  if (!driverPromise) {
    const pending = isTauri() ? sqliteDriver() : Promise.resolve(memoryDriver());
    driverPromise = pending.catch((error) => {
      driverPromise = null;
      throw error;
    });
  }
  return driverPromise;
}

function uid() {
  return crypto.randomUUID();
}
function now() {
  return new Date().toISOString();
}

function parseMeta(value: string | null): GenerationMeta | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<GenerationMeta>;
    return parsed &&
      typeof parsed.model === "string" &&
      (parsed.mode === "txt2img" || parsed.mode === "edit") &&
      typeof parsed.steps === "number" &&
      typeof parsed.cfg === "number" &&
      typeof parsed.guidance === "number" &&
      typeof parsed.sampler === "string" &&
      typeof parsed.seed === "number" &&
      typeof parsed.width === "number" &&
      typeof parsed.height === "number"
      ? (parsed as GenerationMeta)
      : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SQLite driver — used inside Tauri.
// ---------------------------------------------------------------------------

async function sqliteDriver(): Promise<Driver> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  // Surface load/migration failures in DevTools console — otherwise
  // Windows packaged builds give a silent dead "New chat" button.
  let sql: Awaited<ReturnType<typeof Database.load>>;
  try {
    sql = await Database.load(DB_URL);
  } catch (err) {
    console.error(
      `[sovimage] Database.load failed url=${DB_URL} err=`,
      err,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
  // WAL is persistent for the database file. SQLx enables foreign keys on
  // every pooled SQLite connection by default; deletion triggers in migration
  // 2 keep cascades correct even if that default ever changes.
  await sql.execute("PRAGMA journal_mode = WAL");
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
    meta: parseMeta(r.meta_json),
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
      // tauri-plugin-sql (sqlx sqlite) treats `$N` as POSITIONAL binds, so
      // reusing `$3` for two columns fails with "parameter count mismatch".
      // Pass `ts` twice as $3 + $4 explicitly.
      const sqlText =
        "INSERT INTO chats (id, title, created_at, updated_at, pinned, archived) VALUES ($1, $2, $3, $4, 0, 0)";
      const params = [id, title, ts, ts];
      try {
        await sql.execute(sqlText, params);
      } catch (err) {
        // Log SQL + params before re-throw so a packaged-build failure is
        // diagnosable from the DevTools console.
        console.error(
          "[sovimage] chatsCreate SQL failed sql=",
          sqlText,
          "params=",
          params,
          "err=",
          err,
        );
        throw err;
      }
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
        "SELECT id, chat_id, role, kind, content, image_path, meta_json, parent_id, status, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at, rowid",
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
      if (patch.kind !== undefined) {
        sets.push(`kind = $${params.length + 1}`);
        params.push(patch.kind);
      }
      if (patch.meta !== undefined) {
        sets.push(`meta_json = $${params.length + 1}`);
        params.push(patch.meta ? JSON.stringify(patch.meta) : null);
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
        "SELECT message_id, chat_id, snippet(messages_fts, 0, $1, $2, '…', 16) AS snippet FROM messages_fts WHERE messages_fts MATCH $3 LIMIT 50",
        [HIGHLIGHT_START, HIGHLIGHT_END, toFtsPhrase(query)],
      );
      return rows.map((r) => ({
        messageId: r.message_id,
        chatId: r.chat_id,
        snippet: r.snippet,
      }));
    },
    async reconcileInterrupted() {
      const result = await sql.execute(
        "UPDATE messages SET status = 'error', content = 'Interrupted by app restart.' WHERE status IN ('pending', 'queued')",
      );
      return result.rowsAffected;
    },
    async clearAll(resetSettings) {
      // Migration 2 turns this one statement into an atomic settings/chat
      // clear, avoiding BEGIN/COMMIT calls that can land on different pooled
      // connections.
      await sql.execute(
        "INSERT INTO clear_requests (id, reset_settings) VALUES (1, $1)",
        [resetSettings ? 1 : 0],
      );
    },
    async referencedFiles() {
      const rows = await sql.select<{ image_path: string }[]>(
        "SELECT image_path FROM messages WHERE image_path IS NOT NULL",
      );
      return rows.map((row) => row.image_path);
    },
    async migrateMediaPaths(mappings) {
      let changed = 0;
      for (const mapping of mappings) {
        if (mapping.from === mapping.to) continue;
        const result = await sql.execute(
          "UPDATE messages SET image_path = $1 WHERE image_path = $2",
          [mapping.to, mapping.from],
        );
        changed += result.rowsAffected;
      }
      return changed;
    },
  };
}

// ---------------------------------------------------------------------------
// Memory driver — used in browser-dev mode so `next dev` is still usable.
// ---------------------------------------------------------------------------

function memoryDriver(): Driver {
  const chats: Chat[] = [];
  const messages: Record<string, Message[]> = {};

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
          if (patch.kind !== undefined) m.kind = patch.kind;
          if (patch.meta !== undefined) m.meta = patch.meta;
          return;
        }
      }
    },
    async search() {
      return [];
    },
    async reconcileInterrupted() {
      let changed = 0;
      for (const list of Object.values(messages)) {
        for (const message of list) {
          if (message.status !== "pending" && message.status !== "queued") continue;
          message.status = "error";
          message.content = "Interrupted by app restart.";
          changed++;
        }
      }
      return changed;
    },
    async clearAll(resetSettings) {
      chats.splice(0);
      for (const key of Object.keys(messages)) delete messages[key];
      if (resetSettings) {
        // Browser preview has no persisted settings.
      }
    },
    async referencedFiles() {
      return Object.values(messages)
        .flat()
        .flatMap((message) => (message.imagePath ? [message.imagePath] : []));
    },
    async migrateMediaPaths(mappings) {
      const paths = new Map(mappings.map((mapping) => [mapping.from, mapping.to]));
      let changed = 0;
      for (const list of Object.values(messages)) {
        for (const message of list) {
          if (!message.imagePath) continue;
          const next = paths.get(message.imagePath);
          if (!next || next === message.imagePath) continue;
          message.imagePath = next;
          changed++;
        }
      }
      return changed;
    },
  };
}

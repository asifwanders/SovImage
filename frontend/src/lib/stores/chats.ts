"use client";

import { create } from "zustand";
import { db } from "@/lib/db";
import { ipc, onGenerationEvent } from "@/lib/ipc";
import type { Chat, Message } from "@/lib/types";

// Module-scoped registry of active Tauri event listeners for in-flight
// generations. Lets us tear down listeners deterministically when a chat
// is deleted or the user cancels — prevents native handle leaks.
//
// `cancelledIds` plugs a small race: between inserting the placeholder and
// `await onGenerationEvent(...)` resolving, the user could delete the chat.
// `remove()` records the id here; the post-await registration consults it
// and refuses to attach an orphan listener.
const liveListeners = new Map<string, () => void>();
const cancelledIds = new Set<string>();

function stopListener(messageId: string) {
  const fn = liveListeners.get(messageId);
  if (fn) {
    fn();
    liveListeners.delete(messageId);
  }
}

interface ChatStore {
  chats: Chat[];
  activeId: string | null;
  messages: Record<string, Message[]>;
  loading: boolean;

  load: () => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
  create: (title?: string) => Promise<Chat>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  loadMessages: (chatId: string) => Promise<void>;
  appendUserMessage: (chatId: string, text: string) => Promise<Message>;
  generate: (
    chatId: string,
    prompt: string,
    initImagePath?: string | null,
    negative?: string | null,
  ) => Promise<Message>;
}

export const useChats = create<ChatStore>((set, get) => ({
  chats: [],
  activeId: null,
  messages: {},
  loading: false,

  load: async () => {
    set({ loading: true });
    const driver = await db();
    const chats = await driver.chatsList();
    set({ chats, loading: false });
  },

  setActive: async (id) => {
    set({ activeId: id });
    if (id && !get().messages[id]) {
      await get().loadMessages(id);
    }
  },

  create: async (title = "New chat") => {
    const driver = await db();
    const c = await driver.chatsCreate(title);
    set((s) => ({
      chats: [c, ...s.chats],
      activeId: c.id,
      messages: { ...s.messages, [c.id]: [] },
    }));
    return c;
  },

  rename: async (id, title) => {
    const driver = await db();
    await driver.chatsRename(id, title);
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c,
      ),
    }));
  },

  remove: async (id) => {
    // Cancel + tear down any in-flight generation listeners scoped to this
    // chat before dropping the messages map. Otherwise the listener fires
    // for a chat that no longer exists.
    const inflight = get().messages[id] ?? [];
    for (const m of inflight) {
      if (m.status === "pending") {
        ipc.cancelGeneration(m.id).catch(() => {});
        cancelledIds.add(m.id);
        stopListener(m.id);
      }
    }
    const driver = await db();
    await driver.chatsDelete(id);
    set((s) => {
      const messages = { ...s.messages };
      delete messages[id];
      return {
        chats: s.chats.filter((c) => c.id !== id),
        messages,
        activeId: s.activeId === id ? null : s.activeId,
      };
    });
  },

  loadMessages: async (chatId) => {
    const driver = await db();
    const msgs = await driver.messagesList(chatId);
    set((s) => ({ messages: { ...s.messages, [chatId]: msgs } }));
  },

  appendUserMessage: async (chatId, text) => {
    const driver = await db();
    const m = await driver.messagesAppend({
      chatId,
      role: "user",
      kind: "text",
      content: text,
      parentId: null,
    });
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: [...(s.messages[chatId] ?? []), m],
      },
    }));
    return m;
  },

  generate: async (chatId, prompt, initImagePath = null, negative = null) => {
    const driver = await db();
    // Insert the assistant placeholder ourselves so the row exists in SQLite
    // before the sidecar starts emitting events. The Rust `generate_image`
    // command returns a transient stub; we ignore its id and use ours.
    const placeholder = await driver.messagesAppend({
      chatId,
      role: "assistant",
      kind: "image",
      content: null,
      parentId: null,
      status: "pending",
    });
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: [...(s.messages[chatId] ?? []), placeholder],
      },
    }));

    // Subscribe to generation events for THIS message id. Rust emits on
    // `generation://<placeholder.id>` once we pass it through to the
    // sidecar. The Rust command must use the id we created. The unsubscribe
    // is registered in `liveListeners` so a chat-delete or cancel can tear
    // it down deterministically.
    //
    // Wrap in try/catch — if the listener attach itself fails, mark the
    // placeholder errored and return BEFORE invoking the sidecar so we
    // don't leak a generation with no consumer for its events.
    let stop: (() => void) | null = null;
    try {
      stop = await onGenerationEvent(placeholder.id, async (ev) => {
      try {
        const evt = ev.event as string;
        if (evt === "cancelled") {
          await driver.messageUpdate(placeholder.id, {
            status: "cancelled",
            content: "Cancelled",
          });
          set((s) => ({
            messages: {
              ...s.messages,
              [chatId]: (s.messages[chatId] ?? []).map((m) =>
                m.id === placeholder.id
                  ? { ...m, status: "cancelled", kind: "error", content: "Cancelled" }
                  : m,
              ),
            },
          }));
          stopListener(placeholder.id);
          return;
        }
        if (ev.event === "done" && ev.imagePath) {
          await driver.messageUpdate(placeholder.id, {
            status: "done",
            imagePath: ev.imagePath,
          });
          set((s) => ({
            messages: {
              ...s.messages,
              [chatId]: (s.messages[chatId] ?? []).map((m) =>
                m.id === placeholder.id
                  ? { ...m, status: "done", imagePath: ev.imagePath ?? null }
                  : m,
              ),
            },
          }));
          stopListener(placeholder.id);
        } else if (ev.event === "error") {
          await driver.messageUpdate(placeholder.id, {
            status: "error",
            content: ev.message ?? "Generation failed",
          });
          set((s) => ({
            messages: {
              ...s.messages,
              [chatId]: (s.messages[chatId] ?? []).map((m) =>
                m.id === placeholder.id
                  ? {
                      ...m,
                      status: "error",
                      kind: "error",
                      content: ev.message ?? "Generation failed",
                    }
                  : m,
              ),
            },
          }));
          stopListener(placeholder.id);
        }
      } catch {
        /* swallow — UI bubble shows stale pending state */
      }
    });
    } catch (e) {
      await driver.messageUpdate(placeholder.id, {
        status: "error",
        content: "Failed to subscribe to generation events",
      });
      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: (s.messages[chatId] ?? []).map((m) =>
            m.id === placeholder.id
              ? { ...m, status: "error", kind: "error", content: String(e) }
              : m,
          ),
        },
      }));
      return placeholder;
    }

    // If the chat was deleted during the listener-attach await, refuse to
    // register the orphan listener — and immediately tear it down.
    if (cancelledIds.has(placeholder.id)) {
      cancelledIds.delete(placeholder.id);
      stop?.();
      return placeholder;
    }
    if (stop) liveListeners.set(placeholder.id, stop);

    // Kick off the actual sidecar run. Pass our placeholder id so the Rust
    // supervisor emits on the matching `generation://<id>` channel.
    await invokeGenerate({
      messageId: placeholder.id,
      chatId,
      prompt,
      initImagePath,
      negative,
    });

    return placeholder;
  },
}));

// Local thin wrapper so the chats store doesn't import ipc internals for a
// single extra param. Re-exported via lib/ipc.ts later if needed elsewhere.
async function invokeGenerate(input: {
  messageId: string;
  chatId: string;
  prompt: string;
  initImagePath: string | null;
  negative: string | null;
}) {
  const t =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
      ? await import("@tauri-apps/api/core")
      : null;
  if (t) {
    await t.invoke("generate_image", { ...input, meta: null });
  }
  // Browser-dev: the mock generation event stream in lib/ipc.ts already
  // simulates completion against the message id passed to onGenerationEvent.
}

"use client";

import { create } from "zustand";
import { discardAttachment } from "@/lib/attachments";
import { db } from "@/lib/db";
import { clearManagedMedia } from "@/lib/gc";
import { ipc, onGenerationEvent } from "@/lib/ipc";
import type { Chat, GenerationEvent, Message } from "@/lib/types";
import { useAttachment } from "@/lib/stores/attachment";
import { removeProgress, updateProgress } from "@/lib/stores/progress";
import { useToasts } from "@/lib/stores/toasts";

const liveListeners = new Map<string, () => void>();
const cancelRequested = new Set<string>();
const cancellationJobs = new Map<string, Promise<void>>();
const generationEventChains = new Map<string, Promise<void>>();
const generationStarts = new Map<string, Promise<void>>();
let reconcilePromise: Promise<number> | null = null;
let reconciliationReported = false;
let activationGeneration = 0;
let requestedActivation: string | null = null;
let clearGeneration = 0;
let chatsLoaded = false;
let chatLoadPromise: Promise<void> | null = null;
let createJob: Promise<Chat> | null = null;
let clearJob: Promise<void> | null = null;
let clearJobResetsSettings = false;
const activeChatMutations = new Set<Promise<unknown>>();

function trackChatMutation<T>(operation: Promise<T>) {
  activeChatMutations.add(operation);
  const done = () => activeChatMutations.delete(operation);
  void operation.then(done, done);
  return operation;
}

export function chatAcceptsAttachments(chatId: string) {
  return (
    clearJob === null &&
    useChats.getState().chats.some((chat) => chat.id === chatId)
  );
}

function stopListener(messageId: string) {
  liveListeners.get(messageId)?.();
  liveListeners.delete(messageId);
  removeProgress(messageId);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function touchChat(chats: Chat[], id: string) {
  const updatedAt = new Date().toISOString();
  return chats
    .map((chat) => (chat.id === id ? { ...chat, updatedAt } : chat))
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

function revokePreviewBlobs(messages: Message[]) {
  for (const message of messages) {
    if (message.imagePath?.startsWith("blob:")) {
      URL.revokeObjectURL(message.imagePath);
    }
  }
}

function waitForTerminal(messageId: string, timeoutMs = 15_000) {
  return new Promise<void>((resolve) => {
    const terminal = () => {
      const message = Object.values(useChats.getState().messages)
        .flat()
        .find((candidate) => candidate.id === messageId);
      return !message || (message.status !== "pending" && message.status !== "queued");
    };
    if (terminal()) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const unsubscribe = useChats.subscribe(() => {
      if (terminal()) finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

async function ensureReconciled(driver: Awaited<ReturnType<typeof db>>) {
  reconcilePromise ??= driver.reconcileInterrupted();
  let interrupted: number;
  try {
    interrupted = await reconcilePromise;
  } catch (error) {
    reconcilePromise = null;
    throw error;
  }
  if (interrupted > 0 && !reconciliationReported) {
    reconciliationReported = true;
    useToasts
      .getState()
      .push(`${interrupted} interrupted generation${interrupted === 1 ? " was" : "s were"} recovered.`);
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
  clearAll: (resetSettings?: boolean) => Promise<void>;
  loadMessages: (chatId: string) => Promise<void>;
  appendUserMessage: (
    chatId: string,
    text: string,
    initImagePath?: string | null,
  ) => Promise<Message>;
  generate: (
    chatId: string,
    prompt: string,
    initImagePath?: string | null,
  ) => Promise<Message>;
  cancel: (messageId: string) => Promise<void>;
}

export const useChats = create<ChatStore>((set, get) => ({
  chats: [],
  activeId: null,
  messages: {},
  loading: false,

  load: async () => {
    if (chatLoadPromise) return chatLoadPromise;
    const operation = (async () => {
      set({ loading: true });
      try {
        const driver = await db();
        await ensureReconciled(driver);
        const chats = await driver.chatsList();
        chatsLoaded = true;
        set((state) => ({
          chats,
          activeId:
            state.activeId && chats.some((chat) => chat.id === state.activeId)
              ? state.activeId
              : null,
        }));
      } catch (error) {
        useToasts.getState().push(`Could not load chats: ${errorText(error)}`, 8000);
        throw error;
      } finally {
        set({ loading: false });
      }
    })();
    chatLoadPromise = operation;
    try {
      await operation;
    } finally {
      if (chatLoadPromise === operation) chatLoadPromise = null;
    }
  },

  setActive: async (id) => {
    const generation = ++activationGeneration;
    requestedActivation = id;
    try {
      if (!get().chats.some((chat) => chat.id === id)) {
        if (id && !chatsLoaded) await get().load();
        if (generation !== activationGeneration) return;
        if (id && !get().chats.some((chat) => chat.id === id)) {
          throw new Error("Chat not found.");
        }
      }
      if (id && !get().messages[id]) await get().loadMessages(id);
      if (generation !== activationGeneration) return;
      if (id && !get().chats.some((chat) => chat.id === id)) {
        throw new Error("Chat not found.");
      }
      set({ activeId: id });
    } finally {
      if (generation === activationGeneration) requestedActivation = null;
    }
  },

  create: (title = "New chat") => {
    if (createJob) return createJob;
    const operation = trackChatMutation(
      (async () => {
        if (clearJob) await clearJob;
        if (chatLoadPromise) await chatLoadPromise;
        const chat = await (await db()).chatsCreate(title);
        set((state) => ({
          chats: [chat, ...state.chats],
          messages: { ...state.messages, [chat.id]: [] },
        }));
        return chat;
      })(),
    );
    createJob = operation;
    const clear = () => {
      if (createJob === operation) createJob = null;
    };
    void operation.then(clear, clear);
    return operation;
  },

  rename: (id, title) =>
    trackChatMutation(
      (async () => {
        if (clearJob) await clearJob;
        await (await db()).chatsRename(id, title);
        set((state) => ({
          chats: touchChat(
            state.chats.map((chat) => (chat.id === id ? { ...chat, title } : chat)),
            id,
          ),
        }));
      })(),
    ),

  remove: (id) =>
    trackChatMutation(
      (async () => {
        if (clearJob) await clearJob;
        if (get().activeId === id || requestedActivation === id) {
          activationGeneration++;
          requestedActivation = null;
        }
        const running = (get().messages[id] ?? []).filter(
          (message) => message.status === "pending" || message.status === "queued",
        );
        await Promise.all(running.map((message) => get().cancel(message.id)));
        const driver = await db();
        const deletedMessages = get().messages[id] ?? (await driver.messagesList(id));
        await driver.chatsDelete(id);
        await useAttachment
          .getState()
          .discard(id)
          .catch((error) =>
            useToasts
              .getState()
              .push(`The chat was deleted, but its draft attachment could not be removed: ${errorText(error)}`),
          );
        revokePreviewBlobs(deletedMessages);
        set((state) => {
          const messages = { ...state.messages };
          delete messages[id];
          return {
            chats: state.chats.filter((chat) => chat.id !== id),
            messages,
            activeId: state.activeId === id ? null : state.activeId,
          };
        });
        const attachmentCleanup = await Promise.allSettled(
          deletedMessages.flatMap((message) =>
            message.imagePath ? [discardAttachment(message.imagePath)] : [],
          ),
        );
        if (attachmentCleanup.some((cleanup) => cleanup.status === "rejected")) {
          useToasts
            .getState()
            .push("Chat deleted, but some image files could not be removed.");
        }
      })(),
    ),

  clearAll: async (resetSettings = false) => {
    if (clearJob) {
      const includedSettings = clearJobResetsSettings;
      await clearJob;
      if (!resetSettings || includedSettings) return;
      return get().clearAll(true);
    }
    clearJobResetsSettings = resetSettings;
    const operation = (async () => {
      await Promise.allSettled([...activeChatMutations]);
      activationGeneration++;
      requestedActivation = null;
      clearGeneration++;
      if (chatLoadPromise) await chatLoadPromise;
      const running = Object.values(get().messages)
        .flat()
        .filter(
          (message) => message.status === "pending" || message.status === "queued",
        );
      await Promise.all(running.map((message) => get().cancel(message.id)));
      liveListeners.forEach((stop) => stop());
      liveListeners.clear();
      cancelRequested.clear();
      revokePreviewBlobs(Object.values(get().messages).flat());
      await (await db()).clearAll(resetSettings);
      await Promise.allSettled([useAttachment.getState().discardAll()]);
      const mediaCleanup = await Promise.allSettled([clearManagedMedia()]);
      set({ chats: [], activeId: null, messages: {} });
      const failed = mediaCleanup.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failed) {
        useToasts.getState().push(
          `Chats were cleared, but some media could not be removed: ${errorText(failed.reason)}`,
          8000,
        );
      }
    })();
    clearJob = operation;
    try {
      await operation;
    } finally {
      if (clearJob === operation) {
        clearJob = null;
        clearJobResetsSettings = false;
      }
    }
  },

  loadMessages: async (chatId) => {
    const generation = clearGeneration;
    const driver = await db();
    await ensureReconciled(driver);
    const messages = await driver.messagesList(chatId);
    if (
      generation !== clearGeneration ||
      !get().chats.some((chat) => chat.id === chatId)
    ) {
      return;
    }
    set((state) => ({
      messages: { ...state.messages, [chatId]: messages },
    }));
  },

  appendUserMessage: (chatId, text, initImagePath = null) =>
    trackChatMutation(
      (async () => {
        if (clearJob) await clearJob;
        const message = await (await db()).messagesAppend({
          chatId,
          role: "user",
          kind: initImagePath ? "image" : "text",
          content: text,
          imagePath: initImagePath,
          parentId: null,
        });
        set((state) => ({
          chats: touchChat(state.chats, chatId),
          messages: {
            ...state.messages,
            [chatId]: [...(state.messages[chatId] ?? []), message],
          },
        }));
        return message;
      })(),
    ),

  generate: (chatId, prompt, initImagePath = null) =>
    trackChatMutation(
      (async () => {
        if (clearJob) await clearJob;
        const driver = await db();
        const placeholder = await driver.messagesAppend({
          chatId,
          role: "assistant",
          kind: "image",
          content: null,
          parentId: null,
          status: "queued",
        });
        set((state) => ({
          chats: touchChat(state.chats, chatId),
          messages: {
            ...state.messages,
            [chatId]: [...(state.messages[chatId] ?? []), placeholder],
          },
        }));

        let terminal = false;
        let started = false;
        const patchLocal = (patch: Partial<Message>) =>
          set((state) => ({
            messages: {
              ...state.messages,
              [chatId]: (state.messages[chatId] ?? []).map((message) =>
                message.id === placeholder.id ? { ...message, ...patch } : message,
              ),
            },
          }));
        const finish = async (
          patch: Pick<Message, "status" | "content" | "imagePath" | "meta">,
        ) => {
          if (terminal) return;
          terminal = true;
          patchLocal(patch);
          stopListener(placeholder.id);
          try {
            await driver.messageUpdate(placeholder.id, patch);
          } catch (error) {
            useToasts
              .getState()
              .push(`Generation finished, but its history could not be saved: ${errorText(error)}`, 8000);
          }
        };
        const markStarted = async () => {
          if (started) return;
          started = true;
          patchLocal({ status: "pending" });
          await driver
            .messageUpdate(placeholder.id, { status: "pending" })
            .catch((error) => {
              useToasts
                .getState()
                .push(`Could not save queue state: ${errorText(error)}`);
            });
        };
        const handleEvent = async (event: GenerationEvent) => {
          if (terminal) return;
          if (event.event === "step") {
            await markStarted();
            updateProgress(placeholder.id, event);
            return;
          }
          if (event.event === "started") {
            await markStarted();
            return;
          }
          if (event.event === "queued") return;
          if (event.event === "cancelled") {
            await finish({
              status: "cancelled",
              content: "Cancelled",
              imagePath: null,
              meta: null,
            });
            return;
          }
          if (event.event === "error") {
            await finish({
              status: "error",
              content: event.message || "Generation failed.",
              imagePath: null,
              meta: null,
            });
            return;
          }
          if (!event.imagePath) {
            await finish({
              status: "error",
              content: "The generation engine returned no image.",
              imagePath: null,
              meta: null,
            });
            return;
          }
          await finish({
            status: "done",
            content: null,
            imagePath: event.imagePath,
            meta: event.meta ?? null,
          });
        };

        let stop: (() => void) | null = null;
        let eventChain = Promise.resolve();
        try {
          stop = await onGenerationEvent(placeholder.id, (event) => {
            eventChain = eventChain
              .then(() => handleEvent(event))
              .catch((error) =>
                finish({
                  status: "error",
                  content: `Could not process generation result: ${errorText(error)}`,
                  imagePath: null,
                  meta: null,
                }),
              );
            const chain = eventChain;
            generationEventChains.set(placeholder.id, chain);
            const clearChain = () => {
              if (generationEventChains.get(placeholder.id) === chain) {
                generationEventChains.delete(placeholder.id);
              }
            };
            void chain.then(clearChain, clearChain);
          });
          if (cancelRequested.delete(placeholder.id)) {
            stop();
            return placeholder;
          }
          liveListeners.set(placeholder.id, stop);
          const start = ipc.generateImage({
            messageId: placeholder.id,
            prompt,
            initImagePath,
            meta: null,
          });
          generationStarts.set(placeholder.id, start);
          try {
            await start;
          } finally {
            if (generationStarts.get(placeholder.id) === start) {
              generationStarts.delete(placeholder.id);
            }
          }
        } catch (error) {
          stop?.();
          cancelRequested.delete(placeholder.id);
          await finish({
            status: "error",
            content: `Could not start generation: ${errorText(error)}`,
            imagePath: null,
            meta: null,
          });
        }
        return placeholder;
      })(),
    ),

  cancel: async (messageId) => {
    const existing = cancellationJobs.get(messageId);
    if (existing) return existing;
    const job = (async () => {
      const message = Object.values(get().messages)
        .flat()
        .find((candidate) => candidate.id === messageId);
      if (!message || (message.status !== "pending" && message.status !== "queued")) return;
      const listenerWasAttached = liveListeners.has(messageId);
      if (!listenerWasAttached) cancelRequested.add(messageId);
      if (listenerWasAttached) {
        await generationStarts.get(messageId)?.catch(() => {});
      }
      try {
        await ipc.cancelGeneration(messageId);
      } catch (error) {
        cancelRequested.delete(messageId);
        throw error;
      }
      if (listenerWasAttached) {
        await waitForTerminal(messageId);
        await generationEventChains.get(messageId);
      }
      const current = Object.values(get().messages)
        .flat()
        .find((candidate) => candidate.id === messageId);
      if (!current || (current.status !== "pending" && current.status !== "queued")) {
        if (listenerWasAttached) cancelRequested.delete(messageId);
        return;
      }
      stopListener(messageId);
      if (listenerWasAttached) cancelRequested.delete(messageId);
      set((state) => ({
        messages: {
          ...state.messages,
          [message.chatId]: (state.messages[message.chatId] ?? []).map((candidate) =>
            candidate.id === messageId
              ? { ...candidate, status: "cancelled", content: "Cancelled" }
              : candidate,
          ),
        },
      }));
      await (await db())
        .messageUpdate(messageId, {
          status: "cancelled",
          content: "Cancelled",
          imagePath: null,
          meta: null,
        })
        .catch((error) =>
          useToasts
            .getState()
            .push(`Generation was cancelled, but its history could not be saved: ${errorText(error)}`),
        );
    })();
    cancellationJobs.set(messageId, job);
    try {
      await job;
    } finally {
      cancellationJobs.delete(messageId);
    }
  },
}));

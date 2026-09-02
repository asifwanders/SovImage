"use client";

import { create } from "zustand";
import {
  discardAttachment,
  persistAttachment,
  type PendingAttachment,
} from "@/lib/attachments";
import { useToasts } from "@/lib/stores/toasts";

interface AttachmentState {
  drafts: Record<string, PendingAttachment>;
  select: (
    chatId: string,
    input: File | (() => Promise<File>),
    isValid: () => boolean,
  ) => Promise<void>;
  settle: (chatId: string) => Promise<void>;
  restore: (chatId: string, reservation: AttachmentReservation) => Promise<void>;
  commit: (chatId: string, reservation: AttachmentReservation) => void;
  discard: (chatId: string) => Promise<void>;
  discardAll: () => Promise<void>;
  take: (chatId: string) => AttachmentReservation | null;
}

interface AttachmentReservation {
  draft: PendingAttachment;
  generation: number;
}

const selectionGeneration = new Map<string, number>();
const selectionJobs = new Map<string, Promise<void>>();

function supersedeSelection(chatId: string) {
  const generation = (selectionGeneration.get(chatId) ?? 0) + 1;
  selectionGeneration.set(chatId, generation);
  return generation;
}

export const useAttachment = create<AttachmentState>((set, get) => {
  const forgetIfIdle = (chatId: string, generation: number) => {
    if (
      selectionGeneration.get(chatId) === generation &&
      !selectionJobs.has(chatId) &&
      !get().drafts[chatId]
    ) {
      selectionGeneration.delete(chatId);
    }
  };
  const replaceDraft = async (chatId: string, draft: PendingAttachment) => {
    const previous = get().drafts[chatId];
    set((state) => ({ drafts: { ...state.drafts, [chatId]: draft } }));
    if (previous && previous.path !== draft.path) {
      await discardAttachment(previous.path).catch((error) =>
        useToasts
          .getState()
          .push(
            `The new attachment is ready, but the previous draft could not be removed: ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
    }
  };

  return {
    drafts: {},
    select: (chatId, input, isValid) => {
      const generation = supersedeSelection(chatId);
      const operation = (async () => {
        const file = typeof input === "function" ? await input() : input;
        if (selectionGeneration.get(chatId) !== generation || !isValid()) return;
        const draft = await persistAttachment(file);
        if (selectionGeneration.get(chatId) !== generation || !isValid()) {
          await discardAttachment(draft.path);
          return;
        }
        await replaceDraft(chatId, draft);
      })();
      selectionJobs.set(chatId, operation);
      const clear = () => {
        if (selectionJobs.get(chatId) === operation) {
          selectionJobs.delete(chatId);
          forgetIfIdle(chatId, generation);
        }
      };
      void operation.then(clear, clear);
      return operation;
    },
    settle: async (chatId) => {
      for (;;) {
        const operation = selectionJobs.get(chatId);
        if (!operation) return;
        const generation = selectionGeneration.get(chatId);
        try {
          await operation;
        } catch (error) {
          if (selectionGeneration.get(chatId) === generation) throw error;
        }
        if (selectionJobs.get(chatId) === operation) return;
      }
    },
    restore: async (chatId, reservation) => {
      if (selectionGeneration.get(chatId) !== reservation.generation) {
        await discardAttachment(reservation.draft.path);
        return;
      }
      await replaceDraft(chatId, reservation.draft);
    },
    commit: (chatId, reservation) => {
      forgetIfIdle(chatId, reservation.generation);
    },
    discard: async (chatId) => {
      const generation = supersedeSelection(chatId);
      const pending = selectionJobs.get(chatId);
      selectionJobs.delete(chatId);
      const draft = get().drafts[chatId];
      if (draft) {
        set((state) => {
          const drafts = { ...state.drafts };
          delete drafts[chatId];
          return { drafts };
        });
        await discardAttachment(draft.path);
      }
      await pending?.catch(() => {});
      forgetIfIdle(chatId, generation);
    },
    discardAll: async () => {
      const generations = new Map(
        [...selectionGeneration.keys()].map((chatId) => [
          chatId,
          supersedeSelection(chatId),
        ]),
      );
      const pending = [...selectionJobs.values()];
      selectionJobs.clear();
      const drafts = Object.values(get().drafts);
      set({ drafts: {} });
      await Promise.allSettled([
        ...pending,
        ...drafts.map((draft) => discardAttachment(draft.path)),
      ]);
      for (const [chatId, generation] of generations) {
        forgetIfIdle(chatId, generation);
      }
    },
    take: (chatId) => {
      const generation = supersedeSelection(chatId);
      selectionJobs.delete(chatId);
      const draft = get().drafts[chatId] ?? null;
      if (!draft) return null;
      set((state) => {
        const drafts = { ...state.drafts };
        delete drafts[chatId];
        return { drafts };
      });
      return { draft, generation };
    },
  };
});

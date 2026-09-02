"use client";

import { create } from "zustand";
import type { GenerationEvent } from "@/lib/types";

interface GenerationProgress {
  step: number;
  total: number;
  percent: number;
}

interface ProgressState {
  progress: Record<string, GenerationProgress>;
  update: (messageId: string, event: GenerationEvent) => void;
  remove: (messageId: string) => void;
  get: (messageId: string) => GenerationProgress | null;
}

export const useGenerationProgress = create<ProgressState>((set, get) => ({
  progress: {},
  update: (messageId, event) => {
    if (event.event === "step" && event.total > 0 && event.step >= 0) {
      const step = Math.min(event.step, event.total);
      const total = event.total;
      const percent = Math.round((step / total) * 100);
      set((s) => ({
        progress: {
          ...s.progress,
          [messageId]: { step, total, percent },
        },
      }));
    }
  },
  remove: (messageId) => {
    set((s) => {
      const p = { ...s.progress };
      delete p[messageId];
      return { progress: p };
    });
  },
  get: (messageId) => get().progress[messageId] ?? null,
}));

export const updateProgress = (messageId: string, event: GenerationEvent) => {
  useGenerationProgress.getState().update(messageId, event);
};

export const removeProgress = (messageId: string) => {
  useGenerationProgress.getState().remove(messageId);
};

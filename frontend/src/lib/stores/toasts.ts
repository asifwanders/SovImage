"use client";

import { create } from "zustand";

export interface Toast {
  id: string;
  message: string;
  /** Milliseconds before auto-dismiss. 0 disables auto-dismiss. */
  durationMs: number;
}

interface ToastStore {
  items: Toast[];
  push: (message: string, durationMs?: number) => string;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastStore>((set) => ({
  items: [],
  push: (message, durationMs = 5000) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set((s) => ({ items: [...s.items, { id, message, durationMs }] }));
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

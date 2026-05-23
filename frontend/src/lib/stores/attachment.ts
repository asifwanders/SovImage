"use client";

import { create } from "zustand";

interface AttachmentState {
  /// Absolute path of the most recently dropped/attached file. Composer reads
  /// it on send + clears it after.
  pendingPath: string | null;
  /// Display name shown next to the textarea.
  pendingName: string | null;
  set: (path: string | null, name?: string | null) => void;
}

export const useAttachment = create<AttachmentState>((set) => ({
  pendingPath: null,
  pendingName: null,
  set: (path, name) => set({ pendingPath: path, pendingName: name ?? null }),
}));

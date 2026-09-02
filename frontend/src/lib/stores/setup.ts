"use client";

import { create } from "zustand";
import { ipc, onSetupState } from "@/lib/ipc";
import type { SetupState } from "@/lib/types";
import { useToasts } from "@/lib/stores/toasts";

interface Store extends SetupState {
  estimatedBytes: number | null;
  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
  startDownload: () => Promise<void>;
  confirmDownload: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  retry: () => Promise<void>;
}

let bootstrapped = false;
let setupUnsubscribe: (() => void) | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollGeneration = 0;
let operationPending = false;
let pollErrorShown = false;

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const useSetup = create<Store>((set, get) => {
  const apply = (state: SetupState) => {
    set({
      ...state,
      estimatedBytes:
        state.phase === "idle" || state.phase === "profiling"
          ? null
          : state.total || get().estimatedBytes,
    });
    if (state.phase === "ready" || state.phase === "error") stopPolling();
    if (
      state.phase === "awaiting_confirm" &&
      state.tier != null &&
      !state.total &&
      get().estimatedBytes == null
    ) {
      ipc
        .setupEstimateSize(state.tier)
        .then((estimatedBytes) => set({ estimatedBytes }))
        .catch((error) =>
          useToasts
            .getState()
            .push(`Could not read the model download size: ${message(error)}`),
        );
    }
  };

  const refresh = async () => {
    const state = await ipc.setupState();
    apply(state);
    return state;
  };

  const stopPolling = () => {
    pollGeneration++;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };

  const startPolling = () => {
    stopPolling();
    const generation = pollGeneration;
    const tick = async () => {
      if (generation !== pollGeneration) return;
      try {
        const state = await refresh();
        pollErrorShown = false;
        if (state.phase === "ready" || state.phase === "error") return;
      } catch (error) {
        if (!pollErrorShown) {
          pollErrorShown = true;
          useToasts
            .getState()
            .push(`Lost contact with setup: ${message(error)}`, 8000);
        }
      }
      if (generation === pollGeneration) pollTimer = setTimeout(tick, 750);
    };
    pollTimer = setTimeout(tick, 750);
  };

  const run = async (action: () => Promise<void>) => {
    if (operationPending) return;
    operationPending = true;
    try {
      await action();
      const state = await refresh();
      if (state.phase !== "ready" && state.phase !== "error") startPolling();
    } catch (error) {
      const detail = message(error);
      try {
        await refresh();
      } catch {
        set({ phase: "error", error: detail });
      }
      useToasts.getState().push(`Setup failed: ${detail}`, 8000);
      throw error;
    } finally {
      operationPending = false;
    }
  };

  return {
    phase: "idle",
    tier: null,
    modelId: null,
    downloaded: 0,
    total: 0,
    bytesPerSec: 0,
    etaSecs: 0,
    error: null,
    supported: null,
    device: null,
    estimatedBytes: null,

    bootstrap: async () => {
      if (bootstrapped) return;
      bootstrapped = true;
      try {
        setupUnsubscribe?.();
        setupUnsubscribe = await onSetupState(apply);
        const state = await refresh();
        if (state.phase === "idle") {
          await get().startDownload();
        } else if (state.phase !== "ready" && state.phase !== "error") {
          startPolling();
        }
      } catch (error) {
        bootstrapped = false;
        const detail = message(error);
        set({ phase: "error", error: detail });
        useToasts.getState().push(`Could not initialize setup: ${detail}`, 8000);
        throw error;
      }
    },

    refresh: async () => {
      const state = await refresh();
      if (state.tier != null) {
        set({ estimatedBytes: await ipc.setupEstimateSize(state.tier) });
      }
    },

    startDownload: () =>
      run(async () => {
        if (get().phase !== "idle") return;
        set({ phase: "profiling", error: null });
        await ipc.setupStartDownload();
      }),
    confirmDownload: () =>
      run(async () => {
        if (get().phase !== "awaiting_confirm") return;
        await ipc.setupConfirmDownload();
      }),
    pause: () =>
      run(async () => {
        if (get().phase !== "downloading") return;
        await ipc.setupPause();
      }),
    resume: () =>
      run(async () => {
        if (get().phase !== "paused") return;
        await ipc.setupResume();
      }),
    retry: () =>
      run(async () => {
        if (get().phase !== "error") return;
        const backend = await ipc.setupState();
        if (backend.phase === "idle") {
          set({ phase: "profiling", error: null });
          await ipc.setupStartDownload();
        } else if (backend.phase === "error") {
          set({ error: null });
          await ipc.setupRetry();
        } else {
          apply(backend);
        }
      }),
  };
});

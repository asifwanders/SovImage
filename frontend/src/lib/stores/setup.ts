"use client";

import { create } from "zustand";
import type { SetupState } from "@/lib/types";
import { ipc, onDownloadProgress, onSetupPhase } from "@/lib/ipc";

interface Store extends SetupState {
  bootstrap: () => Promise<void>;
  startDownload: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  retry: () => Promise<void>;
}

// Module-scoped singletons. Survive component re-mounts (React 19 StrictMode
// dev double-invoke, HMR) so we never register the same listener twice or
// run two concurrent poll loops.
let bootstrapped = false;
let downloadUnsub: (() => void) | null = null;
let phaseUnsub: (() => void) | null = null;
let pollGen = 0; // bumped on retry to invalidate any in-flight tick loop

export const useSetup = create<Store>((set, get) => ({
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

  bootstrap: async () => {
    // Guard against React 19 StrictMode double-invoke + HMR re-runs. Without
    // this, two parallel poll loops + two duplicate download listeners
    // would race and double-count progress. If bootstrap throws we must
    // reset the flag so the next retry() can re-enter — otherwise the
    // splash gets stuck forever.
    if (bootstrapped) return;
    bootstrapped = true;

    let state: SetupState;
    try {
      state = await ipc.setupState();
    } catch (e) {
      bootstrapped = false;
      throw e;
    }
    set(state);

    downloadUnsub?.();
    downloadUnsub = await onDownloadProgress((p) => {
      set({
        downloaded: p.downloaded,
        total: p.total,
        bytesPerSec: p.bytesPerSec,
        etaSecs: p.etaSecs,
      });
    });
    // Server-pushed phase transitions short-circuit the poll for snappy UI.
    phaseUnsub?.();
    phaseUnsub = await onSetupPhase((phase) => {
      set({ phase });
    });

    // Poll while setup is mid-flight (mock path). Real Tauri build emits a
    // `setup://phase` event, but polling is a cheap belt-and-braces. Stop on
    // terminal phases, on unknown phase (defensive), after a hard cap, or
    // when `pollGen` is bumped (e.g. by retry()).
    const TERMINAL = new Set<string>(["ready", "error"]);
    const KNOWN = new Set<string>([
      "idle",
      "profiling",
      "downloading",
      "paused",
      "verifying",
      "starting_sidecar",
      "ready",
      "error",
    ]);
    const myGen = pollGen;
    let attempts = 0;
    const tick = async () => {
      if (myGen !== pollGen) return; // superseded
      try {
        const fresh = await ipc.setupState();
        set(fresh);
        attempts++;
        if (TERMINAL.has(fresh.phase)) return;
        if (!KNOWN.has(fresh.phase)) return;
        if (attempts > 600) return; // ~2 min @ 200 ms
        setTimeout(tick, 200);
      } catch {
        /* swallow — next event/tick will recover */
      }
    };
    if (!TERMINAL.has(state.phase)) tick();
  },

  startDownload: async () => {
    // Backend (or mock layer) owns phase transitions. Don't pre-set
    // "downloading" here — the next poll tick + progress events advance it.
    await ipc.setupStartDownload();
  },
  pause: async () => {
    await ipc.setupPause();
  },
  resume: async () => {
    await ipc.setupResume();
  },
  retry: async () => {
    // Invalidate any tick loop running from the prior bootstrap pass, then
    // re-bootstrap fresh so a new tick + listeners attach cleanly.
    pollGen++;
    bootstrapped = false;
    set({ error: null });
    await ipc.setupRetry();
    await get().bootstrap();
    await get().startDownload();
  },
}));

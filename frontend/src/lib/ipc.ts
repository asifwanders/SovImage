"use client";

import type { GenerationEvent, GenerationMeta, SetupState } from "./types";

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  return mock<T>(cmd, args);
}

export const ipc = {
  setupState: () => call<SetupState>("setup_state"),
  setupStartDownload: () => call<void>("setup_start_download"),
  setupEstimateSize: (tier: number) =>
    call<number>("setup_estimate_size", { tier }),
  setupConfirmDownload: () => call<void>("setup_confirm_download"),
  setupPause: () => call<void>("setup_pause"),
  setupResume: () => call<void>("setup_resume"),
  setupRetry: () => call<void>("setup_retry"),
  generateImage: (input: {
    messageId: string;
    prompt: string;
    initImagePath?: string | null;
    meta?: Partial<Pick<GenerationMeta, "seed" | "width" | "height">> | null;
  }) => call<void>("generate_image", input),
  cancelGeneration: (messageId: string) =>
    call<void>("cancel_generation", { messageId }),
  obsoleteModelInventory: () =>
    call<ObsoleteModelInventory>("obsolete_model_inventory"),
  cleanupObsoleteModels: () =>
    call<ObsoleteModelInventory>("cleanup_obsolete_models"),
  migrateLocalStorage: () =>
    call<LocalStorageMigration>("migrate_local_storage"),
};

export interface ObsoleteModelInventory {
  bytes: number;
  files: string[];
}

export interface LocalStorageMigration {
  oldRoot: string;
  newRoot: string;
  localMediaFiles: string[];
  movedBytes: number;
}

export async function onSetupState(
  cb: (state: SetupState) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    mockSetupCallbacks.add(cb);
    return () => mockSetupCallbacks.delete(cb);
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<SetupState>("setup://state", (event) => cb(event.payload));
}

export async function onGenerationEvent(
  messageId: string,
  cb: (event: GenerationEvent) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    mockGenerationCallbacks.set(messageId, cb);
    return () => {
      mockGenerationCallbacks.delete(messageId);
      const job = mockGenerationJobs.get(messageId);
      if (job) clearTimeout(job);
      mockGenerationJobs.delete(messageId);
    };
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<GenerationEvent>(`generation://${messageId}`, (event) =>
    cb(event.payload),
  );
}

// Browser preview deliberately does not copy production model manifests.
// It reports itself as a mock runtime and only exercises the UI contract.
const mockSetup: SetupState = {
  phase: "idle",
  tier: null,
  modelId: "browser-preview",
  downloaded: 0,
  total: 0,
  bytesPerSec: 0,
  etaSecs: 0,
  error: null,
  supported: true,
  device: "Browser preview (no inference engine)",
};
const mockSetupCallbacks = new Set<(state: SetupState) => void>();
const mockGenerationCallbacks = new Map<
  string,
  (event: GenerationEvent) => void
>();
const mockGenerationJobs = new Map<string, ReturnType<typeof setTimeout>>();

function emitMockSetup() {
  const snapshot = { ...mockSetup };
  mockSetupCallbacks.forEach((cb) => cb(snapshot));
}

function startMockGeneration(messageId: string, mode: GenerationMeta["mode"]) {
  const callback = mockGenerationCallbacks.get(messageId);
  if (!callback) throw new Error("generation listener is not attached");
  let step = 0;
  const total = 4;
  const tick = () => {
    step++;
    if (step <= total) {
      callback({ event: "step", step, total });
      mockGenerationJobs.set(messageId, setTimeout(tick, 250));
      return;
    }
    const svg = placeholderSvg(`#${messageId.slice(0, 6)}`);
    const meta: GenerationMeta = {
      model: "browser-preview",
      mode,
      seed: 0,
      width: 1024,
      height: 1024,
      steps: total,
      cfg: 1,
      guidance: 3.5,
      sampler: "euler",
    };
    callback({
      event: "done",
      imagePath: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
      meta,
    });
    mockGenerationJobs.delete(messageId);
  };
  mockGenerationJobs.set(messageId, setTimeout(tick, 250));
}

async function mock<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  switch (cmd) {
    case "setup_state":
      return { ...mockSetup } as T;
    case "setup_estimate_size":
      return 0 as T;
    case "setup_start_download":
    case "setup_retry":
      Object.assign(mockSetup, { phase: "profiling", error: null });
      emitMockSetup();
      setTimeout(() => {
        mockSetup.phase = "ready";
        emitMockSetup();
      }, 150);
      return undefined as T;
    case "setup_confirm_download":
    case "setup_resume":
      mockSetup.phase = "ready";
      emitMockSetup();
      return undefined as T;
    case "setup_pause":
      return undefined as T;
    case "generate_image":
      startMockGeneration(
        String(args?.messageId),
        args?.initImagePath ? "edit" : "txt2img",
      );
      return undefined as T;
    case "cancel_generation": {
      const id = String(args?.messageId);
      const job = mockGenerationJobs.get(id);
      if (job) clearTimeout(job);
      mockGenerationJobs.delete(id);
      mockGenerationCallbacks.get(id)?.({ event: "cancelled" });
      return undefined as T;
    }
    case "obsolete_model_inventory":
    case "cleanup_obsolete_models":
      return { bytes: 0, files: [] } as T;
    case "migrate_local_storage":
      return {
        oldRoot: "browser-preview",
        newRoot: "browser-preview",
        localMediaFiles: [],
        movedBytes: 0,
      } as T;
    default:
      throw new Error(`unknown ipc command: ${cmd}`);
  }
}

function placeholderSvg(label: string) {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024'><defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'><stop offset='0%' stop-color='#00b9a0'/><stop offset='100%' stop-color='#005b56'/></linearGradient></defs><rect width='1024' height='1024' fill='url(#g)'/><text x='50%' y='50%' fill='white' font-family='sans-serif' font-size='42' text-anchor='middle' dominant-baseline='middle'>${label}</text></svg>`;
}

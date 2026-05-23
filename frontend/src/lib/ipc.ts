"use client";

import type {
  DownloadProgress,
  GenerationEvent,
  GenerationMeta,
  Message,
  SetupState,
} from "./types";

// ---------------------------------------------------------------------------
// IPC = the *narrow* surface that crosses into Rust: setup + generation. All
// chat/message/settings persistence goes through `lib/db.ts` (plugin-sql),
// not through here.
// ---------------------------------------------------------------------------

async function tauriCore() {
  if (typeof window === "undefined") return null;
  if (!("__TAURI_INTERNALS__" in window)) return null;
  return await import("@tauri-apps/api/core");
}

async function tauriEvent() {
  if (typeof window === "undefined") return null;
  if (!("__TAURI_INTERNALS__" in window)) return null;
  return await import("@tauri-apps/api/event");
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = await tauriCore();
  if (t) return t.invoke<T>(cmd, args);
  return mock<T>(cmd, args);
}

export const ipc = {
  setupState: () => call<SetupState>("setup_state"),
  setupStartDownload: () => call<void>("setup_start_download"),
  setupPause: () => call<void>("setup_pause"),
  setupResume: () => call<void>("setup_resume"),
  setupRetry: () => call<void>("setup_retry"),

  generateImage: (input: {
    chatId: string;
    prompt: string;
    initImagePath: string | null;
    meta: Partial<GenerationMeta>;
  }) => call<Message>("generate_image", input),
  cancelGeneration: (messageId: string) =>
    call<void>("cancel_generation", { messageId }),
};

export async function onDownloadProgress(
  cb: (p: DownloadProgress) => void,
): Promise<() => void> {
  const ev = await tauriEvent();
  if (!ev) return mockDownloadStream(cb);
  const un = await ev.listen<DownloadProgress>("download://progress", (e) =>
    cb(e.payload),
  );
  return un;
}

export async function onSetupPhase(
  cb: (p: SetupState["phase"]) => void,
): Promise<() => void> {
  const ev = await tauriEvent();
  if (!ev) return () => {};
  const un = await ev.listen<SetupState["phase"]>("setup://phase", (e) =>
    cb(e.payload),
  );
  return un;
}

export async function onGenerationEvent(
  messageId: string,
  cb: (e: GenerationEvent) => void,
): Promise<() => void> {
  const ev = await tauriEvent();
  if (!ev) {
    return mockGenerationStream(messageId, cb);
  }
  const un = await ev.listen<GenerationEvent>(
    `generation://${messageId}`,
    (e) => cb(e.payload),
  );
  return un;
}

// ---------------------------------------------------------------------------
// Browser-dev mock: setup phase loop + fake generation completion. The chat
// persistence path is handled by the memory driver in lib/db.ts; we only
// need to fake the event channels here.
// ---------------------------------------------------------------------------

interface MockSetup extends SetupState {}
const setupStore: MockSetup = {
  phase: "idle",
  tier: null,
  modelId: null,
  downloaded: 0,
  total: 0,
  bytesPerSec: 0,
  etaSecs: 0,
  error: null,
  supported: true,
  device: "Browser dev (mocked)",
};

const downloadCallbacks = new Set<(p: DownloadProgress) => void>();
let mockDownloadActive = false;

function mockDownloadStream(cb: (p: DownloadProgress) => void) {
  downloadCallbacks.add(cb);
  return () => downloadCallbacks.delete(cb);
}
function emitDownload(p: DownloadProgress) {
  downloadCallbacks.forEach((cb) => cb(p));
}

function mockGenerationStream(
  _messageId: string,
  cb: (e: GenerationEvent) => void,
): () => void {
  let cancelled = false;
  let steps = 0;
  const total = 4;
  const tick = () => {
    if (cancelled) return;
    steps++;
    if (steps <= total) {
      cb({ id: _messageId, event: "step", step: steps, total });
      setTimeout(tick, 300);
    } else {
      const svg = placeholderSvg(`#${_messageId.slice(0, 6)}`);
      cb({
        id: _messageId,
        event: "done",
        imagePath: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
      });
    }
  };
  setTimeout(tick, 400);
  return () => {
    cancelled = true;
  };
}

async function mock<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await new Promise((r) => setTimeout(r, 30));
  switch (cmd) {
    case "setup_state":
      return setupStore as unknown as T;
    case "setup_start_download": {
      if (mockDownloadActive) return undefined as unknown as T;
      mockDownloadActive = true;
      const total = 6_500_000_000;
      Object.assign(setupStore, {
        phase: "profiling",
        tier: 3,
        modelId: "flux1-dev-q8_0",
        total,
      });
      setTimeout(() => {
        setupStore.phase = "downloading";
        let downloaded = 0;
        const chunk = total / 80;
        const interval = setInterval(() => {
          downloaded = Math.min(total, downloaded + chunk);
          setupStore.downloaded = downloaded;
          setupStore.bytesPerSec = chunk * 10;
          setupStore.etaSecs = Math.max(
            0,
            Math.round((total - downloaded) / (chunk * 10)),
          );
          emitDownload({
            modelId: "flux1-dev-q8_0",
            downloaded,
            total,
            bytesPerSec: setupStore.bytesPerSec,
            etaSecs: setupStore.etaSecs,
          });
          if (downloaded >= total) {
            clearInterval(interval);
            setupStore.phase = "verifying";
            setTimeout(() => {
              setupStore.phase = "starting_sidecar";
              setTimeout(() => {
                setupStore.phase = "ready";
                mockDownloadActive = false;
              }, 400);
            }, 600);
          }
        }, 80);
      }, 500);
      return undefined as unknown as T;
    }
    case "setup_pause":
    case "setup_resume":
      return undefined as unknown as T;
    case "setup_retry":
      Object.assign(setupStore, {
        phase: "idle",
        downloaded: 0,
        bytesPerSec: 0,
        etaSecs: 0,
        error: null,
      });
      return undefined as unknown as T;

    case "generate_image": {
      // Returns a transient placeholder; the chats store inserts the row
      // into the (memory) DB itself. Browser-mock has no real spawn.
      const out: Message = {
        id: crypto.randomUUID(),
        chatId: args!.chatId as string,
        role: "assistant",
        kind: "image",
        content: null,
        imagePath: null,
        meta: null,
        parentId: null,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      return out as unknown as T;
    }
    case "cancel_generation":
      return undefined as unknown as T;
  }
  throw new Error(`unknown ipc cmd: ${cmd}`);
}

function placeholderSvg(prompt: string) {
  const t = (prompt || "preview").slice(0, 60);
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024'>
    <defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'>
      <stop offset='0%' stop-color='#00b9a0'/>
      <stop offset='100%' stop-color='#005b56'/>
    </linearGradient></defs>
    <rect width='1024' height='1024' fill='url(#g)'/>
    <text x='50%' y='50%' fill='white' font-family='sans-serif' font-size='42'
      text-anchor='middle' dominant-baseline='middle'>${escapeXml(t)}</text>
  </svg>`;
}
function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

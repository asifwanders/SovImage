export type Tier = 1 | 2 | 3;

export type SetupPhase =
  | "idle"
  | "profiling"
  | "awaiting_confirm"
  | "downloading"
  | "paused"
  | "verifying"
  | "starting_sidecar"
  | "ready"
  | "error";

export interface SetupState {
  phase: SetupPhase;
  tier: Tier | null;
  modelId: string | null;
  downloaded: number;
  total: number;
  bytesPerSec: number;
  etaSecs: number;
  error: string | null;
  /** Whether the detected host is supported for generation. `null` until probed. */
  supported: boolean | null;
  /** Best-effort device label (e.g. "Apple Silicon", "Non-NVIDIA Windows"). */
  device: string | null;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
}

export type MessageRole = "user" | "assistant" | "system";
export type MessageKind = "text" | "image" | "error";
export type MessageStatus =
  | "queued"
  | "pending"
  | "done"
  | "error"
  | "cancelled";

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  kind: MessageKind;
  content: string | null;
  imagePath: string | null;
  meta: GenerationMeta | null;
  parentId: string | null;
  status: MessageStatus;
  createdAt: string;
}

export type GenerationMode = "txt2img" | "edit";

export interface GenerationMeta {
  model: string;
  mode: GenerationMode;
  steps: number;
  cfg: number;
  guidance: number;
  sampler: string;
  seed: number;
  width: number;
  height: number;
}

export interface SearchHit {
  messageId: string;
  chatId: string;
  snippet: string;
}

export interface DownloadProgress {
  modelId: string;
  downloaded: number;
  total: number;
  bytesPerSec: number;
  etaSecs: number;
}

export type GenerationEvent =
  | { event: "queued" }
  | { event: "started" }
  | { event: "step"; step: number; total: number }
  | { event: "done"; imagePath: string; meta?: GenerationMeta }
  | { event: "error"; message?: string }
  | { event: "cancelled" };

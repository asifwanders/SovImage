export type Tier = 1 | 2 | 3;

export type SetupPhase =
  | "idle"
  | "profiling"
  | "downloading"
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
export type MessageStatus = "pending" | "done" | "error" | "cancelled";

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

export interface GenerationMeta {
  model: string;
  steps: number;
  cfg: number;
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

export interface GenerationEvent {
  id: string;
  event: "step" | "done" | "error";
  step?: number;
  total?: number;
  imagePath?: string;
  message?: string;
}

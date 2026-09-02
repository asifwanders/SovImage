"use client";

import { isTauriRuntime } from "./ipc";

export const EXTERNAL_LINKS = {
  source: "https://github.com/asifwanders/SovImage",
  issues: "https://github.com/asifwanders/SovImage/issues/new",
  discussions: "https://github.com/asifwanders/SovImage/discussions",
  docs: "https://github.com/asifwanders/SovImage#readme",
  privacy: "https://github.com/asifwanders/SovImage/blob/main/PRIVACY.md",
  notices:
    "https://github.com/asifwanders/SovImage/blob/main/THIRD_PARTY_NOTICES.md",
} as const;

export async function openExternal(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS links are allowed.");
  if (isTauriRuntime()) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(parsed.toString());
    return;
  }
  window.open(parsed.toString(), "_blank", "noopener,noreferrer");
}

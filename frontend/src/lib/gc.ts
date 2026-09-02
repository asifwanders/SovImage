"use client";

import { db } from "./db";
import { isTauriRuntime } from "./ipc";

export async function sweepOrphanFiles(
  protectedFiles: Iterable<string> = [],
  directories = ["images", "attachments"],
) {
  if (!isTauriRuntime()) return { removed: 0, kept: 0, failed: 0 };
  const [{ appLocalDataDir, join }, { exists, readDir, remove }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const root = await appLocalDataDir();
  const referenced = new Set([
    ...(await (await db()).referencedFiles()),
    ...protectedFiles,
  ]);
  let removed = 0;
  let kept = 0;
  let failed = 0;

  for (const name of directories) {
    const dir = await join(root, name);
    if (!(await exists(dir))) continue;
    for (const entry of await readDir(dir)) {
      if (!entry.isFile) {
        kept++;
        continue;
      }
      const path = await join(dir, entry.name);
      if (referenced.has(path)) {
        kept++;
        continue;
      }
      try {
        await remove(path);
        removed++;
      } catch {
        failed++;
      }
    }
  }
  return { removed, kept, failed };
}

export async function clearManagedMedia() {
  if (!isTauriRuntime()) return;
  const [{ appLocalDataDir, join }, { exists, remove }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const root = await appLocalDataDir();
  for (const name of ["images", "attachments"]) {
    const dir = await join(root, name);
    if (await exists(dir)) await remove(dir, { recursive: true });
  }
}

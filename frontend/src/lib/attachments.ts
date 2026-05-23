"use client";

/**
 * Persist a dropped/attached file into `<app_data>/attachments/<uuid>.<ext>`
 * and return the absolute path. Used by both the Composer paperclip and the
 * DropOverlay. In browser-dev (no Tauri), returns a `blob:` URL for preview
 * but no real path — the mock generation runtime ignores init images anyway.
 */
export async function persistAttachment(file: File): Promise<{ path: string; name: string } | null> {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    return { path: URL.createObjectURL(file), name: file.name };
  }

  const [{ appDataDir, join, sep }, { mkdir, writeFile, exists }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);

  const root = await appDataDir();
  const dir = await join(root, "attachments");
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }

  const ext = (file.name.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".bin").toLowerCase();
  const safeExt = /^\.(png|jpg|jpeg|webp|gif|bmp)$/.test(ext) ? ext : ".png";
  const filename = `${crypto.randomUUID()}${safeExt}`;
  const out = await join(dir, filename);

  const buf = new Uint8Array(await file.arrayBuffer());
  await writeFile(out, buf);

  // Tauri's path APIs return strings with the host's native separator.
  const _ = sep; // silence unused
  return { path: out, name: file.name };
}

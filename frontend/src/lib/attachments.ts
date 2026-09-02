"use client";

import {
  inspectImage,
  MAX_ATTACHMENT_BYTES,
} from "./image-validation";

export interface PendingAttachment {
  path: string;
  name: string;
}

export async function persistAttachment(file: File): Promise<PendingAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Images must be 25 MB or smaller.");
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const image = inspectImage(buf);
  await decodeImage(buf, image.mime);
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    return {
      path: URL.createObjectURL(new Blob([buf], { type: image.mime })),
      name: file.name,
    };
  }

  const [{ appLocalDataDir, join }, { mkdir, writeFile, exists }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);

  const root = await appLocalDataDir();
  const dir = await join(root, "attachments");
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }

  const filename = `${crypto.randomUUID()}${image.extension}`;
  const out = await join(dir, filename);
  await writeFile(out, buf);
  return { path: out, name: file.name };
}

async function decodeImage(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Choose a decodable PNG or JPEG image."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function discardAttachment(path: string) {
  if (path.startsWith("blob:")) {
    URL.revokeObjectURL(path);
    return;
  }
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  const [{ appLocalDataDir, join }, { exists, remove }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const root = await appLocalDataDir();
  const dirs = await Promise.all([
    join(root, "attachments"),
    join(root, "images"),
  ]);
  const normalized = path.replaceAll("\\", "/");
  const managed = dirs.some((dir) => {
    const normalizedDir = dir.replaceAll("\\", "/").replace(/\/$/, "");
    if (!normalized.startsWith(`${normalizedDir}/`)) return false;
    const name = normalized.slice(normalizedDir.length + 1);
    return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:png|jpe?g|gif|bmp|webp)$/i.test(
      name,
    );
  });
  if (!managed) return;
  if (await exists(path)) await remove(path);
}

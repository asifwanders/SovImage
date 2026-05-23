"use client";

import { db } from "./db";

/**
 * Boot-time sweep: delete PNG files under `<app_data>/images/` that are not
 * referenced by any message row in SQLite. Orphans accumulate when the user
 * cancels generations mid-flight (the row gets `status = cancelled` and
 * `image_path = null`, but a partially-written PNG may still be on disk).
 *
 * No-op in browser-dev (no Tauri = no filesystem access).
 */
export async function sweepOrphanImages(): Promise<{ removed: number; kept: number }> {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (!isTauri) return { removed: 0, kept: 0 };

  const [{ appDataDir, join }, { exists, readDir, remove }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);

  const root = await appDataDir();
  const imagesDir = await join(root, "images");
  if (!(await exists(imagesDir))) return { removed: 0, kept: 0 };

  const driver = await db();
  const sql = await driver.messagesList; // type assertion only; we query directly below
  void sql;

  // Pull every referenced image_path in one query via the underlying plugin-sql
  // Database instance. Reuse the driver — but we exposed only message CRUD.
  // Quick path: import plugin-sql here too.
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const conn = await Database.load("sqlite:sovimage.db");
  const rows = await conn.select<{ image_path: string }[]>(
    "SELECT image_path FROM messages WHERE image_path IS NOT NULL",
  );
  const referenced = new Set(rows.map((r) => r.image_path));

  const entries = await readDir(imagesDir);
  let removed = 0;
  let kept = 0;
  for (const e of entries) {
    if (!e.name?.endsWith(".png")) {
      kept++;
      continue;
    }
    const full = await join(imagesDir, e.name);
    if (referenced.has(full)) {
      kept++;
    } else {
      try {
        await remove(full);
        removed++;
      } catch {
        /* best-effort */
      }
    }
  }
  return { removed, kept };
}

"use client";

import { db, type MediaPathMapping } from "./db";
import { ipc } from "./ipc";

let migrationPromise: ReturnType<typeof runMigration> | null = null;

export function migrateLocalStorage() {
  migrationPromise ??= runMigration().catch((error) => {
    migrationPromise = null;
    throw error;
  });
  return migrationPromise;
}

async function runMigration() {
  const migration = await ipc.migrateLocalStorage();
  if (migration.oldRoot === migration.newRoot) {
    return { ...migration, rewrittenPaths: 0 };
  }

  const { join } = await import("@tauri-apps/api/path");
  const mappings: MediaPathMapping[] = await Promise.all(
    [...new Set(migration.localMediaFiles)].map(async (relative) => {
      const parts = relative.replaceAll("\\", "/").split("/");
      if (
        parts.length !== 2 ||
        !["images", "attachments"].includes(parts[0]) ||
        !parts[1] ||
        parts[1] === "." ||
        parts[1] === ".."
      ) {
        throw new Error(`Storage migration returned an invalid media path: ${relative}`);
      }
      return {
        from: await join(migration.oldRoot, ...parts),
        to: await join(migration.newRoot, ...parts),
      };
    }),
  );
  const rewrittenPaths = await (await db()).migrateMediaPaths(mappings);
  return { ...migration, rewrittenPaths };
}

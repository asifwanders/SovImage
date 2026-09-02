"use client";

import { isTauriRuntime } from "./ipc";

export interface BuildProvenance {
  schema: 2;
  channel: string;
  buildNumber: string;
  nodeVersion: string;
  npmVersion: string;
  sourceCommit: string;
  sourceRef: string;
  sourceDirty: boolean;
  engineCommit: string;
  engineRef: string;
}

export async function readBuildProvenance(): Promise<BuildProvenance | null> {
  if (!isTauriRuntime()) return null;
  const [{ resolveResource }, { readTextFile }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const path = await resolveResource("build-provenance.json");
  const value = JSON.parse(await readTextFile(path)) as Partial<BuildProvenance>;
  if (
    value.schema !== 2 ||
    typeof value.sourceRef !== "string" ||
    typeof value.sourceCommit !== "string" ||
    typeof value.sourceDirty !== "boolean" ||
    typeof value.engineCommit !== "string" ||
    typeof value.engineRef !== "string" ||
    typeof value.channel !== "string" ||
    typeof value.buildNumber !== "string" ||
    typeof value.nodeVersion !== "string" ||
    typeof value.npmVersion !== "string"
  ) {
    throw new Error("Bundled build provenance is invalid.");
  }
  return value as BuildProvenance;
}

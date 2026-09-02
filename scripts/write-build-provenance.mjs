#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "frontend/src-tauri/resources/build-provenance.json");

function git(args, cwd = root) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const sourceDirty =
  git([
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude)frontend/src-tauri/resources/build-provenance.json",
  ]) !== "";
const engine = resolve(root, "vendor/stable-diffusion.cpp");
const npmCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
const npmArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm --version"] : ["--version"];
const provenance = {
  schema: 2,
  channel: process.env.SOVIMAGE_BUILD_CHANNEL || "development",
  buildNumber: process.env.SOVIMAGE_BUILD_NUMBER || "0",
  nodeVersion: process.version.replace(/^v/, ""),
  npmVersion: execFileSync(npmCommand, npmArgs, { encoding: "utf8" }).trim(),
  sourceCommit: git(["rev-parse", "HEAD"]),
  sourceRef:
    process.env.SOVIMAGE_SOURCE_REF ||
    process.env.GITHUB_REF_NAME ||
    git(["describe", "--tags", "--always", "--dirty"]),
  sourceDirty,
  engineCommit: git(["rev-parse", "HEAD"], engine),
  engineRef: git(["describe", "--tags", "--always", "--dirty"], engine),
};

if (process.argv[2] === "--verify") {
  const candidate = resolve(process.argv[3] || output);
  const actual = JSON.parse(readFileSync(candidate, "utf8"));
  const expected = { ...provenance, sourceDirty: false };
  for (const key of [
    "schema",
    "channel",
    "buildNumber",
    "nodeVersion",
    "npmVersion",
    "sourceCommit",
    "sourceRef",
    "sourceDirty",
    "engineCommit",
    "engineRef",
  ]) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `invalid build provenance ${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`,
      );
    }
  }
  for (const key of ["sourceCommit", "engineCommit"]) {
    if (!/^[0-9a-f]{40}$/.test(actual[key]) || /^0+$/.test(actual[key])) {
      throw new Error(`invalid build provenance ${key}`);
    }
  }
  if (provenance.sourceDirty || String(actual.engineRef).endsWith("-dirty")) {
    throw new Error("release provenance must come from clean source and engine trees");
  }
  console.log(`verified ${candidate}`);
} else if (process.argv.length === 2) {
  writeFileSync(output, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`wrote ${output}`);
} else {
  throw new Error("usage: write-build-provenance.mjs [--verify [path]]");
}

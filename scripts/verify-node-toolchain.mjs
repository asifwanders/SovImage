#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedNode = readFileSync(resolve(root, ".node-version"), "utf8").trim();
const packageJson = JSON.parse(
  readFileSync(resolve(root, "frontend/package.json"), "utf8"),
);
const expectedNpm = String(packageJson.packageManager).replace(/^npm@/, "");
const actualNode = process.version.replace(/^v/, "");
const npmCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
const npmArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm --version"] : ["--version"];
const actualNpm = execFileSync(npmCommand, npmArgs, {
  encoding: "utf8",
}).trim();

if (actualNode !== expectedNode || packageJson.engines?.node !== expectedNode) {
  throw new Error(
    `Node mismatch: runtime=${actualNode}, .node-version=${expectedNode}, engines=${packageJson.engines?.node}`,
  );
}
if (!expectedNpm || actualNpm !== expectedNpm) {
  throw new Error(`npm mismatch: runtime=${actualNpm}, packageManager=${expectedNpm}`);
}

console.log(`Node ${actualNode} / npm ${actualNpm} verified`);

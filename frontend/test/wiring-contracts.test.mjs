import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("chat switching is URL-led and chat deletion stays target-scoped", () => {
  assert.match(source("../src/components/ChatView.tsx"), /<div key=\{activeId\}/);
  assert.match(
    source("../src/components/ChatView.tsx"),
    /activeId !== chatIdParam/,
  );
  assert.match(source("../src/components/ChatView.tsx"), /Loading chat…/);
  const chats = source("../src/lib/stores/chats.ts");
  assert.ok(
    chats.indexOf("await get().loadMessages(id)") <
      chats.indexOf("set({ activeId: id })"),
    "history must load before a chat becomes interactive",
  );
  assert.doesNotMatch(chats, /sweepOrphanFiles/);
  assert.match(chats, /discardAttachment\(message\.imagePath\)/);
  assert.match(source("../src/lib/attachments.ts"), /join\(root, "images"\)/);
  assert.ok(
    chats.indexOf("await driver.chatsDelete(id)") <
      chats.indexOf(".discard(id)"),
    "draft deletion must follow the database commit",
  );
  assert.match(
    source("../src/lib/gc.ts"),
    /protectedFiles: Iterable<string> = \[\]/,
  );
  assert.match(chats, /throw new Error\("Chat not found\."\)/);
  assert.match(chats, /generation !== clearGeneration/);
  assert.match(chats, /requestedActivation === id/);
  assert.match(chats, /if \(clearJob\)/);
  assert.match(
    chats,
    /create: \(title[\s\S]*?if \(clearJob\) await clearJob;/,
  );
  assert.match(chats, /activeChatMutations/);
  assert.match(chats, /let createJob: Promise<Chat> \| null/);
  assert.match(chats, /await Promise\.allSettled\(\[\.\.\.activeChatMutations\]\)/);
  assert.match(chats, /appendUserMessage:[\s\S]*?trackChatMutation/);
  assert.match(chats, /generate:[\s\S]*?trackChatMutation/);
  assert.doesNotMatch(source("../src/components/Sidebar.tsx"), /const setActive/);
  assert.match(source("../src/components/ChatView.tsx"), /router\.replace\("\/"\)/);
});

test("generation cancellation waits for start and immutable event chains", () => {
  const chats = source("../src/lib/stores/chats.ts");
  assert.match(chats, /const generationStarts = new Map/);
  assert.match(chats, /await generationStarts\.get\(messageId\)\?\.catch/);
  assert.match(chats, /const chain = eventChain;/);
  assert.match(chats, /generationEventChains\.get\(placeholder\.id\) === chain/);
});

test("renderer filesystem and asset scopes stay media-only", () => {
  const capability = JSON.parse(
    source("../src-tauri/capabilities/default.json"),
  );
  assert.equal(capability.permissions.includes("fs:default"), false);
  assert.equal(capability.permissions.includes("core:event:default"), false);
  const fsScope = capability.permissions.find(
    (permission) => permission?.identifier === "fs:scope",
  );
  assert.deepEqual(
    fsScope.allow.map((entry) => entry.path).sort(),
    [
      "$APPLOCALDATA/attachments",
      "$APPLOCALDATA/attachments/**",
      "$APPLOCALDATA/images",
      "$APPLOCALDATA/images/**",
    ].sort(),
  );
  const provenanceScope = capability.permissions.find(
    (permission) => permission?.identifier === "fs:allow-read-text-file",
  );
  assert.deepEqual(provenanceScope.allow, [
    { path: "$RESOURCE/build-provenance.json" },
  ]);
  const tauri = JSON.parse(source("../src-tauri/tauri.conf.json"));
  assert.deepEqual(tauri.app.security.assetProtocol.scope.sort(), [
    "$APPLOCALDATA/attachments/**",
    "$APPLOCALDATA/images/**",
  ].sort());
  assert.doesNotMatch(JSON.stringify(capability), /\$APPDATA\//);
});

test("legacy media is migrated before database cleanup and app mount", () => {
  const storage = source("../src/lib/storage.ts");
  const gate = source("../src/components/SplashGate.tsx");
  assert.match(storage, /ipc\.migrateLocalStorage\(\)/);
  assert.match(storage, /migrateMediaPaths\(mappings\)/);
  assert.match(gate, /migrateLocalStorage\(\)/);
  assert.ok(
    gate.indexOf("migrateLocalStorage()") < gate.indexOf("sweepOrphanFiles()"),
    "legacy storage must move before orphan cleanup",
  );
  assert.match(gate, /\{ready && <div>\{children\}<\/div>\}/);
  assert.doesNotMatch(gate, /inert=/);
});

test("database configuration matches the cached SQLx URL parser", () => {
  const frontend = source("../src/lib/db.ts");
  const rust = source("../src-tauri/src/db/mod.rs");
  assert.match(frontend, /const DB_URL = "sqlite:sovimage\.db"/);
  assert.match(rust, /DB_URL: &str = "sqlite:sovimage\.db"/);
  assert.doesNotMatch(frontend, /journal_mode=WAL|foreign_keys=ON/);
  assert.match(frontend, /PRAGMA journal_mode = WAL/);
  assert.match(rust, /0002_data_consistency\.sql/);
});

test("Tailwind scans only frontend source candidates", () => {
  const postcss = source("../postcss.config.mjs");
  assert.match(postcss, /path\.join\([^\n]+, "src"\)/);
  assert.match(postcss, /"@tailwindcss\/postcss": \{ base: sourceRoot \}/);
});

test("input and release messaging keep their repaired contracts", () => {
  assert.match(
    source("../src/components/Composer.tsx"),
    /!event\.nativeEvent\.isComposing/,
  );
  const warning = source("../src/lib/effects/tier-warning.ts");
  assert.doesNotMatch(warning, /8 GB|60–90/);
  assert.match(warning, /Lower-memory tier selected/);
  assert.match(
    source("../../scripts/write-build-provenance.mjs"),
    /--untracked-files=all/,
  );
  const splash = source("../src/components/SplashScreen.tsx");
  assert.match(splash, /bytes \/ 1_000_000_000/);
  assert.match(splash, /consentBytes > 0/);
  assert.match(splash, /"<0\.1 GB"/);
  assert.match(splash, /obsoleteModelInventory\(\)/);
  assert.match(splash, /Remove old models/);
  assert.doesNotMatch(splash, /supported !== false &&/);
  assert.match(splash, /await refresh\(\)/);
  assert.match(splash, /role="progressbar"/);
  assert.match(splash, /aria-live="polite"/);
  assert.match(
    source("../src/components/SettingsView.tsx"),
    /Model downloads and external help links use the/,
  );
  const about = source("../src/components/AboutView.tsx");
  assert.doesNotMatch(about, /No cloud|for offline creators|Beta &middot;/);
  assert.match(about, /No prompt uploads/);
  assert.match(about, /offline after setup/);
  assert.match(
    source("../src/components/MotionProvider.tsx"),
    /reducedMotion="user"/,
  );
  assert.match(
    source("../src/components/Bubble.tsx"),
    /message\.status === "cancelled"/,
  );
});

test("rename and delete actions have one guarded finish path", () => {
  const sidebar = source("../src/components/Sidebar.tsx");
  const header = source("../src/components/ChatHeader.tsx");
  assert.match(sidebar, /editingFinished\.current/);
  assert.match(sidebar, /finishEdit\(false\)/);
  assert.match(sidebar, /deletePending\.current/);
  assert.ok(
    sidebar.indexOf('router.replace("/")') < sidebar.indexOf("await remove(id)"),
  );
  assert.match(header, /editingFinished\.current/);
  assert.match(header, /finishEdit\(false\)/);
});

test("message updates preserve an intentionally scrolled-up viewport", () => {
  const messages = source("../src/components/MessageList.tsx");
  assert.match(messages, /const nearBottom = useRef\(true\)/);
  assert.match(messages, /if \(!nearBottom\.current\) return/);
  assert.match(messages, /element\.scrollHeight - element\.scrollTop/);
});

test("sending reserves its attachment before asynchronous persistence", () => {
  const composer = source("../src/components/Composer.tsx");
  assert.ok(
    composer.indexOf("takeAttachment(chatId)") <
      composer.indexOf("await appendUserMessage"),
  );
  assert.match(composer, /attachment could not be restored/);
});

test("attachment selection is last-request-wins and invalidated by removal", () => {
  const store = source("../src/lib/stores/attachment.ts");
  const composer = source("../src/components/Composer.tsx");
  const drop = source("../src/components/DropOverlay.tsx");
  assert.match(store, /const selectionGeneration = new Map/);
  assert.match(store, /const selectionJobs = new Map/);
  assert.match(store, /forgetIfIdle/);
  assert.match(store, /commit: \(chatId, reservation\)/);
  assert.match(store, /selectionGeneration\.get\(chatId\) !== generation/);
  assert.match(store, /await discardAttachment\(draft\.path\)/);
  assert.match(
    store,
    /discard: async \(chatId\) => \{\s+const generation = supersedeSelection\(chatId\)/,
  );
  assert.match(store, /selectionGeneration\.get\(chatId\) !== reservation\.generation/);
  assert.match(composer, /restoreAttachment\(chatId, reservation\)/);
  assert.ok(
    composer.indexOf("await settleAttachment(chatId)") <
      composer.indexOf("takeAttachment(chatId)"),
  );
  assert.match(composer, /selectAttachment\([\s\S]*?chatId,[\s\S]*?input/);
  assert.match(drop, /selectAttachment\([\s\S]*?chatId,[\s\S]*?file/);
  assert.match(composer, /await attach\(async \(\) =>/);
  assert.match(composer, /chatAcceptsAttachments\(chatId\)/);
  assert.match(store, /typeof input === "function" \? await input\(\) : input/);
  assert.match(source("../src/lib/attachments.ts"), /await decodeImage\(buf/);
});

test("setup retry recovers a backend that never left idle", () => {
  const setup = source("../src/lib/stores/setup.ts");
  assert.match(setup, /const backend = await ipc\.setupState\(\)/);
  assert.match(setup, /backend\.phase === "idle"/);
  assert.match(setup, /await ipc\.setupStartDownload\(\)/);
});

test("generation state is announced to assistive technology", () => {
  const bubble = source("../src/components/Bubble.tsx");
  assert.match(bubble, /role="status"/);
  assert.match(bubble, /: "Generating"/);
  assert.match(bubble, /role="alert"/);
  assert.match(bubble, /Image generated/);
  assert.match(bubble, /Cancelled\./);
});

test("completed-image actions avoid duplicate subscriptions and URL resolution", () => {
  const bubble = source("../src/components/Bubble.tsx");
  assert.match(bubble, /useChats\.getState\(\)\.messages/);
  assert.doesNotMatch(bubble, /const messages = useChats/);
  assert.match(bubble, /alt="Attached source image"/);
  assert.match(bubble, /src=\{src\}/);
});

test("repeat search navigation and failed renames remain actionable", () => {
  const sidebar = source("../src/components/Sidebar.tsx");
  const messages = source("../src/components/MessageList.tsx");
  const header = source("../src/components/ChatHeader.tsx");
  assert.match(sidebar, /new CustomEvent\("sovimage:scroll-message"/);
  assert.match(messages, /addEventListener\("sovimage:scroll-message"/);
  assert.match(sidebar, /catch \(error\)[\s\S]*?editGeneration\.current === generation[\s\S]*?setEditingId\(id\)/);
  assert.match(header, /catch \(error\)[\s\S]*?editGeneration\.current === generation[\s\S]*?setDraft\(title\)/);
  assert.match(header, /aria-label=\{`Rename chat \$\{chat\.title\}`\}/);
  assert.match(sidebar, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(source("../src/components/Bubble.tsx"), /disabled=\{!src\}/);
});

test("collapsed navigation retains accessible names", () => {
  const sidebar = source("../src/components/Sidebar.tsx");
  for (const label of ["New chat", "Settings", "About"]) {
    assert.match(sidebar, new RegExp(`aria-label="${label}"`));
  }
  assert.match(sidebar, /Switch to light mode/);
  assert.match(sidebar, /No matching chat titles\./);
  assert.match(
    source("../src/components/EmptyState.tsx"),
    /Select a chat or start a new one/,
  );
});

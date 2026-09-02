"use client";

import { useEffect, useState } from "react";
import {
  Cpu,
  Info,
  LifeBuoy,
  Monitor,
  Moon,
  Palette,
  Sun,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useTheme } from "@/lib/stores/theme";
import { useSetup } from "@/lib/stores/setup";
import { useChats } from "@/lib/stores/chats";
import { useToasts } from "@/lib/stores/toasts";
import { cn, formatBytes } from "@/lib/utils";
import { ipc, type ObsoleteModelInventory } from "@/lib/ipc";
import { EXTERNAL_LINKS, openExternal } from "@/lib/external";
import {
  readBuildProvenance,
  type BuildProvenance,
} from "@/lib/provenance";
import { ConfirmModal } from "./ConfirmModal";
import packageJson from "../../package.json";

const APP_VERSION = packageJson.version;

const THEME_OPTIONS = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
] as const;

async function readSystemInfo(): Promise<{ os: string; arch: string }> {
  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    return { os: "Browser (dev)", arch: "n/a" };
  }
  const mod = await import("@tauri-apps/plugin-os");
  const [platform, arch] = await Promise.all([mod.platform(), mod.arch()]);
  const prettyOs =
    platform === "macos"
      ? "macOS"
      : platform === "windows"
        ? "Windows"
        : platform === "linux"
          ? "Linux"
          : platform;
  return { os: prettyOs, arch };
}

export function SettingsView() {
  // Theme — per-field selectors so unrelated store fields don't re-render.
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  // Setup / hardware
  const tier = useSetup((s) => s.tier);
  const device = useSetup((s) => s.device);
  const modelId = useSetup((s) => s.modelId);
  const phase = useSetup((s) => s.phase);

  // Toasts + chat wipe
  const pushToast = useToasts((s) => s.push);
  const clearAll = useChats((s) => s.clearAll);

  const [sysInfo, setSysInfo] = useState<{ os: string; arch: string }>({
    os: "…",
    arch: "…",
  });
  const [confirmClearChats, setConfirmClearChats] = useState(false);
  const [confirmResetApp, setConfirmResetApp] = useState(false);
  const [obsoleteModels, setObsoleteModels] =
    useState<ObsoleteModelInventory | null>(null);
  const [confirmModelCleanup, setConfirmModelCleanup] = useState(false);
  const [cleaningModels, setCleaningModels] = useState(false);
  const [provenance, setProvenance] = useState<BuildProvenance | null>(null);

  useEffect(() => {
    void readSystemInfo()
      .then(setSysInfo)
      .catch((error) => {
        setSysInfo({ os: "unknown", arch: "unknown" });
        pushToast(
          `Could not read system information: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, [pushToast]);

  useEffect(() => {
    void readBuildProvenance()
      .then(setProvenance)
      .catch((error) =>
        pushToast(
          `Could not read build information: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }, [pushToast]);

  useEffect(() => {
    if (phase !== "ready") return;
    void ipc
      .obsoleteModelInventory()
      .then(setObsoleteModels)
      .catch((error) =>
        pushToast(
          `Could not inspect old model files: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }, [phase, pushToast]);

  const onCleanupModels = async () => {
    setConfirmModelCleanup(false);
    setCleaningModels(true);
    try {
      const removed = await ipc.cleanupObsoleteModels();
      setObsoleteModels({ bytes: 0, files: [] });
      pushToast(
        removed.files.length
          ? `Removed ${removed.files.length} old model file${removed.files.length === 1 ? "" : "s"} (${formatBytes(removed.bytes)}).`
          : "No old model files remained.",
      );
    } catch (error) {
      pushToast(
        `Could not remove old model files: ${error instanceof Error ? error.message : String(error)}`,
        8000,
      );
    } finally {
      setCleaningModels(false);
    }
  };

  const onClearChats = async () => {
    setConfirmClearChats(false);
    try {
      await clearAll(false);
      pushToast("All chats cleared.");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : `Could not clear chats: ${String(error)}`,
        8000,
      );
    }
  };

  const onResetApp = async () => {
    setConfirmResetApp(false);
    try {
      await clearAll(true);
      setTheme("system");
      localStorage.removeItem("sovimage.sidebar.collapsed");
      document.documentElement.setAttribute("data-sidebar-collapsed", "0");
      window.dispatchEvent(new Event("sovimage:sidebar-reset"));
      pushToast("Chats and preferences reset. Downloaded models were kept.");
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : `Could not reset app data: ${String(error)}`,
        8000,
      );
    }
  };

  const tierLabel = tier
    ? `Tier ${tier}`
    : modelId === "browser-preview"
      ? "Browser preview"
      : "Detecting…";
  const activeModel = modelId
    ? modelId
    : "Not loaded";
  const deviceLabel = device ?? "Detecting…";
  const provenanceFallback =
    sysInfo.os === "…"
      ? "…"
      : sysInfo.os === "Browser (dev)"
        ? "Browser preview"
        : "Unavailable";

  return (
    <div className="h-full overflow-y-auto px-8 py-12">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-xs text-muted-text">
            Settings stay local. Model downloads and external help links use the
            network only when you choose them.
          </p>
        </header>

        {/* Appearance */}
        <Section
          icon={<Palette className="w-4 h-4" />}
          title="Appearance"
          description="Choose how SovImage looks. System follows your OS."
        >
          <div
            role="group"
            aria-label="Theme"
            className="inline-flex glass-soft rounded-xl p-1 gap-1"
          >
            {THEME_OPTIONS.map(({ id, label, Icon }) => {
              const active = theme === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTheme(id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-accent/15 text-accent"
                      : "text-muted-text hover:text-foreground",
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </Section>
        {/* Models */}
        <Section
          icon={<Cpu className="w-4 h-4" />}
          title="Models"
          description="Picked automatically from your detected hardware."
        >
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Stat label="Tier" value={tierLabel} mono />
            <Stat label="Device" value={deviceLabel} />
            <Stat label="Active model" value={activeModel} mono />
            <Stat
              label="Status"
              value={phase.replaceAll("_", " ")}
              accent={phase === "ready"}
            />
          </dl>
          {!!obsoleteModels?.bytes && (
            <div className="rounded-xl border border-panel-border p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-text">
                {formatBytes(obsoleteModels.bytes)} of model files from an older
                SovImage release are no longer used.
              </p>
              <button
                type="button"
                disabled={cleaningModels}
                onClick={() => setConfirmModelCleanup(true)}
                className="glass-soft rounded-lg px-3 py-1.5 text-xs text-danger hover:bg-danger/10 disabled:opacity-50 shrink-0"
              >
                {cleaningModels ? "Removing…" : "Remove old models"}
              </button>
            </div>
          )}
        </Section>

        {/* System info */}
        <Section
          icon={<Info className="w-4 h-4" />}
          title="System info"
          description="What this build is running."
        >
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Stat label="Operating system" value={sysInfo.os} />
            <Stat label="Architecture" value={sysInfo.arch} mono />
            <Stat label="App version" value={`v${APP_VERSION}`} mono />
            <Stat
              label="App commit"
              value={provenance?.sourceCommit.slice(0, 7) ?? provenanceFallback}
              mono
              title={provenance?.sourceRef}
            />
            <Stat
              label="Engine commit"
              value={provenance?.engineCommit.slice(0, 7) ?? provenanceFallback}
              mono
              title={provenance?.engineRef}
            />
            {provenance && (
              <Stat
                label="Build"
                value={`${provenance.channel} ${provenance.buildNumber}`}
                mono
              />
            )}
          </dl>
        </Section>

        {/* Help & feedback */}
        <Section
          icon={<LifeBuoy className="w-4 h-4" />}
          title="Help & feedback"
          description="Found a bug, or want to suggest a feature?"
        >
          <div className="flex flex-wrap gap-2">
            <HelpLink
              label="Report a bug"
              url={EXTERNAL_LINKS.issues}
            />
            <HelpLink
              label="Discussions"
              url={EXTERNAL_LINKS.discussions}
            />
            <HelpLink
              label="Docs"
              url={EXTERNAL_LINKS.docs}
            />
            <HelpLink label="Privacy Policy" url={EXTERNAL_LINKS.privacy} />
            <HelpLink
              label="Third-Party Notices"
              url={EXTERNAL_LINKS.notices}
            />
          </div>
        </Section>

        {/* Danger zone */}
        <section
          className="rounded-2xl p-5 flex flex-col gap-3"
          style={{
            background: "rgba(255, 69, 58, 0.05)",
            border: "1px solid rgba(255, 69, 58, 0.30)",
          }}
        >
          <div className="flex items-start gap-2">
            <TriangleAlert
              className="w-4 h-4 mt-0.5"
              style={{ color: "var(--danger)" }}
              aria-hidden="true"
            />
            <div>
              <h2
                className="text-sm font-semibold"
                style={{ color: "var(--danger)" }}
              >
                Danger zone
              </h2>
              <p className="text-xs text-muted-text mt-0.5">
                Destructive actions. These cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <DangerButton
              icon={<Trash2 className="w-3.5 h-3.5" />}
              label="Clear all chats"
              onClick={() => setConfirmClearChats(true)}
            />
            <DangerButton
              icon={<TriangleAlert className="w-3.5 h-3.5" />}
              label="Reset app data"
              onClick={() => setConfirmResetApp(true)}
            />
          </div>
        </section>

        <ConfirmModal
          open={confirmModelCleanup}
          title="Remove old model files?"
          message={`This permanently deletes ${formatBytes(obsoleteModels?.bytes ?? 0)} of model files that this version no longer uses. Current models and generated images stay on disk.`}
          confirmLabel="Remove files"
          danger
          onCancel={() => setConfirmModelCleanup(false)}
          onConfirm={() => void onCleanupModels()}
        />

        <ConfirmModal
          open={confirmClearChats}
          title="Clear all chats?"
          message="This permanently deletes every chat, generated image, and attached input image. This cannot be undone."
          confirmLabel="Clear chats"
          danger
          onCancel={() => setConfirmClearChats(false)}
          onConfirm={onClearChats}
        />

        <ConfirmModal
          open={confirmResetApp}
          title="Reset app data?"
          message="This clears every chat, generated image, attachment, and local preference. Downloaded models stay on disk."
          confirmLabel="Reset"
          danger
          onCancel={() => setConfirmResetApp(false)}
          onConfirm={onResetApp}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local presentational helpers
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel rounded-2xl p-5 flex flex-col gap-3">
      <header className="space-y-0.5">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          {icon && (
            <span style={{ color: "var(--accent)" }} aria-hidden="true">
              {icon}
            </span>
          )}
          {title}
        </h2>
        {description && (
          <p className="text-xs text-muted-text">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  mono,
  accent,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-wider text-muted-text">
        {label}
      </dt>
      <dd
        className={cn(
          "text-xs",
          mono && "font-mono",
          accent && "text-accent font-medium",
        )}
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}

function HelpLink({ label, url }: { label: string; url: string }) {
  const pushToast = useToasts((state) => state.push);
  return (
    <button
      type="button"
      onClick={() =>
        void openExternal(url).catch((error) =>
          pushToast(error instanceof Error ? error.message : String(error)),
        )
      }
      className="glass-soft rounded-lg px-3 py-1.5 text-xs hover:text-accent transition-colors"
    >
      {label}
    </button>
  );
}

function DangerButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors"
      style={{
        color: "var(--danger)",
        background: "rgba(255, 69, 58, 0.10)",
        border: "1px solid rgba(255, 69, 58, 0.30)",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

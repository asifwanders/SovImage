"use client";

import { motion } from "framer-motion";
import { Pause, Play, RotateCw, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { ipc, type ObsoleteModelInventory } from "@/lib/ipc";
import { useSetup } from "@/lib/stores/setup";
import { formatBytes, formatEta } from "@/lib/utils";
import { useToasts } from "@/lib/stores/toasts";
import { EXTERNAL_LINKS, openExternal } from "@/lib/external";
import { ConfirmModal } from "./ConfirmModal";

const PHASE_LABEL: Record<string, string> = {
  idle: "Preparing…",
  profiling: "Detecting hardware…",
  awaiting_confirm: "Ready to download",
  downloading: "Downloading model",
  paused: "Download paused",
  verifying: "Verifying checksum…",
  starting_sidecar: "Starting engine…",
  ready: "Ready",
  error: "Setup failed",
};

// Download disclosures use decimal GB, matching network-provider reporting.
function formatGB(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb < 0.1 ? "<0.1 GB" : `~${gb.toFixed(1)} GB`;
}

export function SplashScreen() {
  // Discrete selectors — avoid re-rendering the whole splash on every 80 ms
  // progress tick. Each field is its own subscription.
  const phase = useSetup((s) => s.phase);
  const tier = useSetup((s) => s.tier);
  const modelId = useSetup((s) => s.modelId);
  const downloaded = useSetup((s) => s.downloaded);
  const total = useSetup((s) => s.total);
  const bytesPerSec = useSetup((s) => s.bytesPerSec);
  const etaSecs = useSetup((s) => s.etaSecs);
  const errorMsg = useSetup((s) => s.error);
  const supported = useSetup((s) => s.supported);
  const device = useSetup((s) => s.device);
  const pause = useSetup((s) => s.pause);
  const resume = useSetup((s) => s.resume);
  const retry = useSetup((s) => s.retry);
  const confirmDownload = useSetup((s) => s.confirmDownload);
  const refresh = useSetup((s) => s.refresh);
  const estimatedBytes = useSetup((s) => s.estimatedBytes);
  const pushToast = useToasts((s) => s.push);
  const [obsoleteModels, setObsoleteModels] =
    useState<ObsoleteModelInventory | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleaningModels, setCleaningModels] = useState(false);
  const launch = (url: string) =>
    void openExternal(url).catch((error) =>
      pushToast(
        `Could not open link: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );

  const pct = total > 0 ? Math.min(100, (downloaded / total) * 100) : 0;
  const isDownloading = phase === "downloading";
  const showProgress =
    phase === "downloading" || phase === "paused" || phase === "verifying";
  const isUnsupported = phase === "error" && supported === false;
  const isAwaitingConfirm = phase === "awaiting_confirm";
  const consentBytes = estimatedBytes ?? total;
  const canCleanObsolete =
    (phase === "awaiting_confirm" || phase === "paused" || phase === "error");

  useEffect(() => {
    if (!canCleanObsolete) return;
    let cancelled = false;
    void ipc
      .obsoleteModelInventory()
      .then((inventory) => {
        if (!cancelled) setObsoleteModels(inventory);
      })
      .catch((error) => {
        if (!cancelled) {
          pushToast(
            `Could not inspect old model files: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canCleanObsolete, phase, pushToast]);

  const cleanupObsoleteModels = async () => {
    setConfirmCleanup(false);
    setCleaningModels(true);
    try {
      const removed = await ipc.cleanupObsoleteModels();
      setObsoleteModels({ bytes: 0, files: [] });
      pushToast(
        removed.files.length
          ? `Removed ${removed.files.length} old model file${removed.files.length === 1 ? "" : "s"} (${formatBytes(removed.bytes)}).`
          : "No old model files remained.",
      );
      await refresh().catch((error) =>
        pushToast(
          `Old models were removed, but setup state could not refresh: ${error instanceof Error ? error.message : String(error)}`,
          8000,
        ),
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

  const obsoleteCleanup =
    canCleanObsolete && (obsoleteModels?.bytes ?? 0) > 0 ? (
      <>
        <button
          type="button"
          disabled={cleaningModels}
          onClick={() => setConfirmCleanup(true)}
          className="glass-soft rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          <Trash2 className="w-3 h-3" />
          Remove old models ({formatBytes(obsoleteModels!.bytes)})
        </button>
        <ConfirmModal
          open={confirmCleanup}
          title="Remove old model files?"
          message={`This permanently deletes ${formatBytes(obsoleteModels!.bytes)} of files from older SovImage releases. Current partial downloads, chats, and images stay on disk.`}
          confirmLabel="Remove files"
          danger
          onCancel={() => setConfirmCleanup(false)}
          onConfirm={() => void cleanupObsoleteModels()}
        />
      </>
    ) : null;

  async function quitApp() {
    if (typeof window === "undefined") return;
    if (!("__TAURI_INTERNALS__" in window)) {
      window.close();
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (error) {
      pushToast(
        `Could not close SovImage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  // ETA only meaningful once we've actually started transferring at a
  // measurable rate — otherwise it flashes "—" then a stale value.
  const hasEta = isDownloading && downloaded > 0 && bytesPerSec > 0;

  if (isAwaitingConfirm) {
    return (
      <div className="h-full w-full relative flex items-center justify-center bg-background overflow-hidden">
        <div className="aurora" aria-hidden />
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative glass-panel rounded-2xl px-10 py-12 w-[520px] max-w-[90vw] flex flex-col items-center gap-5 z-10 text-center"
        >
          <div
            className="w-[150px] h-[105px] relative"
            style={{ filter: "drop-shadow(0 0 24px rgba(0,185,160,0.35))" }}
          >
            <Image
              src="/logo-wordmark.png"
              alt="SovImage"
              fill
              priority
              sizes="150px"
              style={{ objectFit: "contain" }}
            />
          </div>
          <h2 className="text-foreground text-lg font-semibold">
            Local model download
          </h2>
          <p className="text-foreground text-sm leading-relaxed">
            SovImage needs to download{" "}
            {consentBytes > 0 ? (
              <span className="text-accent font-medium">
                {formatGB(consentBytes)}
              </span>
            ) : (
              <span className="text-accent font-medium">the required model files</span>
            )}{" "}
            before generation. Downloads resume if interrupted; a future app
            update may require a new compatible model pack.
          </p>
          <p className="text-muted-text text-[11px] px-4">
            Files are stored in SovImage&apos;s application data folder.
          </p>
          {obsoleteCleanup}
          {modelId && (
            <p className="text-muted-text text-xs">
              {modelId} · tier {tier ?? "—"}
            </p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => quitApp()}
              className="glass-soft rounded-full px-4 py-1.5 text-xs hover:text-accent transition-colors"
            >
              Quit
            </button>
            <button
              type="button"
              onClick={() => void confirmDownload().catch(() => {})}
              className="rounded-full px-5 py-1.5 text-xs font-medium bg-accent text-background hover:opacity-90 transition-opacity"
            >
              Continue
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (isUnsupported) {
    return (
      <div className="h-full w-full relative flex items-center justify-center bg-background overflow-hidden">
        <div className="aurora" aria-hidden />
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative glass-panel rounded-2xl px-10 py-12 w-[480px] max-w-[90vw] flex flex-col items-center gap-4 z-10 text-center"
        >
          <h2 className="text-foreground text-lg font-semibold">
            Unsupported hardware
          </h2>
          {device && (
            <p className="text-muted-text text-xs -mt-2">{device}</p>
          )}
          <p className="text-foreground text-sm leading-relaxed">
            SovImage currently requires Apple Silicon with at least 12 GB of
            unified memory, or an NVIDIA GPU with at least 12 GB of VRAM. Your
            current hardware ({device ?? "unknown"}) is not supported.
          </p>
          {obsoleteCleanup}
          <button
            type="button"
            onClick={() => launch(EXTERNAL_LINKS.issues)}
            className="text-accent text-xs hover:underline"
          >
            Report this on GitHub
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative flex items-center justify-center bg-background overflow-hidden">
      <div className="aurora" aria-hidden />

      <div className="relative glass-panel rounded-2xl px-10 py-12 w-[460px] max-w-[90vw] flex flex-col items-center gap-6 z-10">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{
            opacity: 1,
            y: 0,
            scale: phase === "ready" ? 1 : [1, 1.02, 1],
          }}
          transition={{
            opacity: { duration: 0.4 },
            y: { duration: 0.4 },
            scale: { duration: 2.4, repeat: Infinity, ease: "easeInOut" },
          }}
          className="w-[180px] h-[126px] relative"
          style={{ filter: "drop-shadow(0 0 24px rgba(0,185,160,0.35))" }}
        >
          <Image
            src="/logo-wordmark.png"
            alt="SovImage"
            fill
            priority
            sizes="180px"
            style={{ objectFit: "contain" }}
          />
        </motion.div>

        <p
          className="text-foreground text-sm font-medium"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {PHASE_LABEL[phase] ?? phase}
        </p>

        {modelId && (
          <p className="text-muted-text text-xs -mt-3">
            {modelId} · tier {tier ?? "—"}
          </p>
        )}

        {showProgress && (
          <div className="w-full flex flex-col gap-2">
            <div
              className="h-1.5 w-full rounded-full bg-panel-border overflow-hidden"
              role="progressbar"
              aria-label="Model setup progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
              aria-valuetext={`${formatBytes(downloaded)} of ${formatBytes(total)}`}
            >
              <motion.div
                className="h-full bg-accent"
                animate={{ width: `${pct}%` }}
                transition={{ ease: "linear", duration: 0.2 }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-text">
              <span>
                {formatBytes(downloaded)} / {formatBytes(total)}
              </span>
              <span>
                {phase === "paused"
                  ? "Paused"
                  : isDownloading
                  ? hasEta
                    ? `${formatBytes(bytesPerSec)}/s · ETA ${formatEta(etaSecs)}`
                    : `${formatBytes(bytesPerSec)}/s`
                  : "Verifying…"}
              </span>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col items-center gap-1.5 text-center">
            <div className="text-danger text-xs" role="alert">
              {errorMsg ?? "Unknown error"}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {isDownloading && (
            <button
              type="button"
              onClick={() => void pause().catch(() => {})}
              className="glass-soft rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 hover:text-accent transition-colors"
            >
              <Pause className="w-3 h-3" /> Pause
            </button>
          )}
          {phase === "error" && (
            <button
              type="button"
              onClick={() => void retry().catch(() => {})}
              className="glass-soft rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 hover:text-accent transition-colors"
            >
              <RotateCw className="w-3 h-3" /> Retry
            </button>
          )}
          {phase === "paused" && (
            <button
              type="button"
              onClick={() => void resume().catch(() => {})}
              className="glass-soft rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 hover:text-accent transition-colors"
            >
              <Play className="w-3 h-3" /> Resume
            </button>
          )}
        </div>
        {obsoleteCleanup}
      </div>
    </div>
  );
}

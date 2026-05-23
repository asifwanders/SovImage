"use client";

import { motion } from "framer-motion";
import { Pause, Play, RotateCw } from "lucide-react";
import Image from "next/image";
import { useSetup } from "@/lib/stores/setup";
import { formatBytes, formatEta } from "@/lib/utils";

const PHASE_LABEL: Record<string, string> = {
  idle: "Preparing…",
  profiling: "Detecting hardware…",
  downloading: "Downloading model",
  verifying: "Verifying checksum…",
  starting_sidecar: "Starting engine…",
  ready: "Ready",
  error: "Setup failed",
};

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

  const pct = total > 0 ? (downloaded / total) * 100 : 0;
  const isDownloading = phase === "downloading";
  const showProgress = phase === "downloading" || phase === "verifying";
  const isUnsupported = phase === "error" && supported === false;

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
            SovImage requires Apple Silicon or an NVIDIA GPU. Your current
            hardware ({device ?? "unknown"}) is not supported in this beta.
          </p>
          <a
            href="https://github.com/asifwanders/SovImage/issues/new"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent text-xs hover:underline"
          >
            Report this on GitHub
          </a>
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
          className="w-[220px] h-[80px] relative"
          style={{ filter: "drop-shadow(0 0 24px rgba(0,185,160,0.35))" }}
        >
          <Image
            src="/logo-wordmark.png"
            alt="SovImage"
            fill
            priority
            sizes="220px"
            style={{ objectFit: "contain" }}
          />
        </motion.div>

        <p className="text-foreground text-sm font-medium">
          {PHASE_LABEL[phase] ?? phase}
        </p>

        {modelId && (
          <p className="text-muted-text text-xs -mt-3">
            {modelId} · tier {tier ?? "—"}
          </p>
        )}

        {showProgress && (
          <div className="w-full flex flex-col gap-2">
            <div className="h-1.5 w-full rounded-full bg-panel-border overflow-hidden">
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
                {isDownloading
                  ? `${formatBytes(bytesPerSec)}/s · ${formatEta(etaSecs)}`
                  : "Verifying…"}
              </span>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="text-danger text-xs text-center">
            {errorMsg ?? "Unknown error"}
          </div>
        )}

        <div className="flex gap-2">
          {isDownloading && (
            <button
              onClick={() => pause()}
              className="glass-soft rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 hover:text-accent transition-colors"
            >
              <Pause className="w-3 h-3" /> Pause
            </button>
          )}
          {phase === "error" && (
            <button
              onClick={() => retry()}
              className="glass-soft rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 hover:text-accent transition-colors"
            >
              <RotateCw className="w-3 h-3" /> Retry
            </button>
          )}
          {!isDownloading && phase !== "error" && phase !== "ready" && (
            <button
              onClick={() => resume()}
              className="glass-soft rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 hover:text-accent transition-colors"
            >
              <Play className="w-3 h-3" /> Resume
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

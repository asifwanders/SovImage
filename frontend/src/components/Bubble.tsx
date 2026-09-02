"use client";
/* eslint-disable @next/next/no-img-element -- Tauri asset URLs are local runtime files, not build-time Next assets. */

import { motion } from "framer-motion";
import { AlertTriangle, Check, Copy, Download, RotateCw, X } from "lucide-react";
import type { Ref } from "react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types";
import { useChats } from "@/lib/stores/chats";
import { useGenerationProgress } from "@/lib/stores/progress";
import { useToasts } from "@/lib/stores/toasts";

import { useCallback, useEffect, useState } from "react";

// Raw filesystem paths (e.g. "/Users/.../images/abc.png") can't be loaded
// directly by the webview. Tauri's asset protocol routes them through a
// scoped handler; in browser-dev (or for data: / http:) return the path
// unchanged.
function useResolvedSrc(p: string | null | undefined): string {
  const [resolved, setResolved] = useState({ path: "", src: "" });
  const pushToast = useToasts((state) => state.push);
  const needsConversion =
    !!p &&
    !p.startsWith("data:") &&
    !p.startsWith("http://") &&
    !p.startsWith("https://") &&
    !p.startsWith("asset:") &&
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window;
  useEffect(() => {
    if (!p || !needsConversion) return;
    let cancelled = false;
    import("@tauri-apps/api/core")
      .then(({ convertFileSrc }) => {
        if (!cancelled) setResolved({ path: p, src: convertFileSrc(p) });
      })
      .catch((error) =>
        pushToast(`Could not open image: ${error instanceof Error ? error.message : String(error)}`),
      );
    return () => {
      cancelled = true;
    };
  }, [needsConversion, p, pushToast]);
  if (!p) return "";
  if (!needsConversion) return p;
  return resolved.path === p ? resolved.src : "";
}

function ImageEl({ path, alt }: { path: string; alt: string }) {
  const src = useResolvedSrc(path);
  if (!src) return null;
  return (
    <img src={src} alt={alt} className="rounded-xl max-w-[480px] w-full h-auto block" />
  );
}

export function Bubble({
  message,
  ref,
}: {
  message: Message;
  ref?: Ref<HTMLDivElement>;
}) {
  const isUser = message.role === "user";
  const cancel = useChats((state) => state.cancel);
  const pushToast = useToasts((state) => state.push);
  const onCancel = () =>
    void cancel(message.id).catch((error) =>
      pushToast(
        `Could not cancel generation: ${error instanceof Error ? error.message : String(error)}`,
        8000,
      ),
    );

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "glass-panel rounded-2xl max-w-[720px] min-w-[60px]",
          isUser ? "px-4 py-3" : "p-3",
          isUser &&
            "bg-[linear-gradient(135deg,rgba(0,185,160,0.10),transparent)]",
          message.kind === "error" && "border-danger/40",
        )}
      >
        {isUser && message.imagePath && (
          <div className="mb-2">
            <ImageEl
              path={message.imagePath}
              alt="Attached source image"
            />
          </div>
        )}
        {isUser && message.content && (
          <p className="text-sm whitespace-pre-wrap break-words">
            {message.content}
          </p>
        )}

        {!isUser && message.kind === "image" && (
          <ImageContent message={message} onCancel={onCancel} />
        )}

        {!isUser && message.kind === "text" && message.content && (
          <p className="text-sm whitespace-pre-wrap break-words px-1">
            {message.content}
          </p>
        )}

        {message.kind === "error" && (
          <div role="alert" className="flex items-start gap-2 px-1">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-danger font-medium">
                Generation failed
              </p>
              <p className="text-xs text-muted-text mt-0.5">
                {message.content ?? "Unknown error"}
              </p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ImageContent({
  message,
  onCancel,
}: {
  message: Message;
  onCancel: () => void;
}) {
  const progress = useGenerationProgress((state) => state.get(message.id));
  if (message.status === "pending" || message.status === "queued") {
    return (
      <div className="relative w-full max-w-[480px] aspect-square rounded-xl overflow-hidden glass-soft">
        <div className="shimmer absolute inset-0 rounded-xl" />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-sm font-medium text-foreground glass-soft rounded-full px-4 py-2 backdrop-blur-md"
          >
            {progress
              ? `${progress.percent}%`
              : message.status === "queued"
                ? "Queued"
                : "Generating"}
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel generation"
          title="Cancel"
          className="absolute top-2 right-2 glass-soft rounded-full p-1.5 hover:text-danger transition-colors backdrop-blur-md"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }
  if (message.status === "cancelled") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl w-[360px] max-w-full p-4 border border-panel-border text-muted-text text-xs"
      >
        Cancelled.
      </div>
    );
  }
  if (message.status === "error" || !message.imagePath) {
    return (
      <div role="alert" className="rounded-xl w-[360px] max-w-full p-4 border border-danger/40 text-danger text-xs flex gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>{message.content ?? "Image generation failed."}</span>
      </div>
    );
  }
  return (
    <ImageOverlay message={message} />
  );
}

function ImageOverlay({ message }: { message: Message }) {
  const imagePath = message.imagePath!;
  const src = useResolvedSrc(imagePath);
  const [copied, setCopied] = useState(false);
  const pushToast = useToasts((state) => state.push);

  const handleCopy = useCallback(async () => {
    if (!src) return;
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const png = blob.type === "image/png" ? blob : await convertToPng(src);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      pushToast(
        `Could not copy image: ${err instanceof Error ? err.message : String(err)}`,
        8000,
      );
    }
  }, [src, pushToast]);

  const handleDownload = useCallback(async () => {
    const isTauri =
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (isTauri && !message.imagePath!.startsWith("data:")) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { copyFile } = await import("@tauri-apps/plugin-fs");
        const dest = await save({
          defaultPath: `sovimage-${message.id.slice(0, 8)}.png`,
          filters: [{ name: "PNG image", extensions: ["png"] }],
        });
        if (dest) {
          await copyFile(message.imagePath!, dest);
          pushToast("Image saved.");
        }
      } catch (err) {
        pushToast(
          `Could not save image: ${err instanceof Error ? err.message : String(err)}`,
          8000,
        );
      }
    } else {
      const a = document.createElement("a");
      a.href = src;
      a.download = `sovimage-${message.id.slice(0, 8)}.${src.startsWith("data:image/svg") ? "svg" : "png"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }, [src, message.id, message.imagePath, pushToast]);

  const generate = useChats((s) => s.generate);
  const handleRegenerate = useCallback(async () => {
    const msgs = useChats.getState().messages[message.chatId] ?? [];
    const idx = msgs.findIndex((m) => m.id === message.id);
    if (idx < 0) return;
    const userMsg = msgs
      .slice(0, idx)
      .reverse()
      .find((m) => m.role === "user");
    if (!userMsg) return;
    try {
      await generate(
        message.chatId,
        userMsg.content ?? "",
        userMsg.imagePath,
      );
    } catch (err) {
      pushToast(
        `Could not regenerate image: ${err instanceof Error ? err.message : String(err)}`,
        8000,
      );
    }
  }, [message.chatId, message.id, generate, pushToast]);

  return (
    <div className="relative group">
      <span role="status" aria-live="polite" className="sr-only">
        Image generated
      </span>
      {src && (
        <img
          src={src}
          alt="Generated image"
          className="rounded-xl max-w-[480px] w-full h-auto block"
        />
      )}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <IconBtn
          label={copied ? "Copied!" : "Copy"}
          onClick={handleCopy}
          disabled={!src}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-accent" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </IconBtn>
        <IconBtn label="Download" onClick={handleDownload}>
          <Download className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn label="Regenerate" onClick={handleRegenerate}>
          <RotateCw className="w-3.5 h-3.5" />
        </IconBtn>
      </div>
      {message.meta && (
        <p className="mt-1 px-1 text-[10px] text-muted-text">
          {message.meta.model} · seed {message.meta.seed} · {message.meta.width}×
          {message.meta.height} · {message.meta.steps} steps · cfg {message.meta.cfg}
          {" · "}guidance {message.meta.guidance} · {message.meta.sampler}
        </p>
      )}
    </div>
  );
}

async function convertToPng(src: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("toBlob failed"));
      }, "image/png");
    };
    img.onerror = reject;
    img.src = src;
  });
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="glass-soft rounded-full p-1.5 hover:text-accent transition-colors disabled:opacity-50"
    >
      {children}
    </button>
  );
}

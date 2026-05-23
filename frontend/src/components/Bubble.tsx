"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Copy, Download, RotateCw, X } from "lucide-react";
import type { Ref } from "react";
import { cn } from "@/lib/utils";
import { ipc } from "@/lib/ipc";
import type { Message } from "@/lib/types";

export function Bubble({
  message,
  ref,
}: {
  message: Message;
  ref?: Ref<HTMLDivElement>;
}) {
  const isUser = message.role === "user";
  const onCancel = () => ipc.cancelGeneration(message.id).catch(() => {});

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
          <div className="flex items-start gap-2 px-1">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-danger font-medium">
                Generation failed
              </p>
              <p className="text-xs text-muted-text mt-0.5">
                {message.content ?? "Unknown error"}
              </p>
              <button className="mt-2 inline-flex items-center gap-1 text-[11px] text-danger hover:underline">
                <RotateCw className="w-3 h-3" /> Retry
              </button>
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
  if (message.status === "pending") {
    return (
      <div className="relative w-[360px] h-[360px] max-w-full">
        <div className="shimmer rounded-xl absolute inset-0" />
        <button
          onClick={onCancel}
          aria-label="Cancel generation"
          title="Cancel"
          className="absolute top-2 right-2 glass-soft rounded-full p-1.5 hover:text-danger transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }
  if (message.status === "error" || !message.imagePath) {
    return (
      <div className="rounded-xl w-[360px] max-w-full p-4 border border-danger/40 text-danger text-xs flex gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>{message.content ?? "Image generation failed."}</span>
      </div>
    );
  }
  return (
    <div className="relative group">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={message.imagePath}
        alt={message.content ?? "Generated image"}
        className="rounded-xl max-w-[480px] w-full h-auto block"
      />
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <IconBtn label="Copy">
          <Copy className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn label="Download">
          <Download className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn label="Regenerate">
          <RotateCw className="w-3.5 h-3.5" />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      className="glass-soft rounded-full p-1.5 hover:text-accent transition-colors"
    >
      {children}
    </button>
  );
}

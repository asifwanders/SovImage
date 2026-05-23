"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { useToasts, type Toast as ToastModel } from "@/lib/stores/toasts";

interface Props {
  toast: ToastModel;
}

/**
 * Single toast chip. Glass-panel pill anchored bottom-right via the host.
 * Auto-dismisses after `toast.durationMs` (0 disables).
 */
export function Toast({ toast }: Props) {
  const dismiss = useToasts((s) => s.dismiss);

  useEffect(() => {
    if (toast.durationMs <= 0) return;
    const handle = setTimeout(() => dismiss(toast.id), toast.durationMs);
    return () => clearTimeout(handle);
  }, [toast.id, toast.durationMs, dismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.96 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      role="status"
      aria-live="polite"
      className="glass-panel rounded-full pl-4 pr-2 py-2 flex items-center gap-3 max-w-[420px] shadow-lg"
    >
      <span className="text-foreground text-xs leading-snug">
        {toast.message}
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
        className="rounded-full p-1 text-muted-text hover:text-accent transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  );
}

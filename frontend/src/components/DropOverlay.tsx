"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ImagePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSetup } from "@/lib/stores/setup";
import { useAttachment } from "@/lib/stores/attachment";
import { persistAttachment } from "@/lib/attachments";

export function DropOverlay({ chatId: _chatId }: { chatId: string }) {
  const ready = useSetup((s) => s.phase === "ready");
  const setAttachment = useAttachment((s) => s.set);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      setDragging(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      try {
        const r = await persistAttachment(file);
        if (r) setAttachment(r.path, r.name);
      } catch {
        /* surfaced in console; UI silently ignores */
      }
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [ready, setAttachment]);

  return (
    <AnimatePresence>
      {dragging && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 z-30 flex items-center justify-center p-8 pointer-events-none"
        >
          <div className="glass-panel rounded-2xl border-2 border-dashed border-accent w-full h-full flex flex-col items-center justify-center gap-3 text-accent">
            <ImagePlus className="w-8 h-8" />
            <p className="text-sm font-medium">Drop to start image-to-image</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

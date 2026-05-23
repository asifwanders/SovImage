"use client";

import { AnimatePresence } from "framer-motion";
import { useToasts } from "@/lib/stores/toasts";
import { Toast } from "./Toast";

/**
 * Fixed bottom-right portal-less container for active toasts. Mounted once
 * by `AppShell`. New toasts stack upward; layout animations stay smooth
 * because each `Toast` carries `layout` on the motion div.
 */
export function ToastHost() {
  const items = useToasts((s) => s.items);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <Toast toast={t} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}

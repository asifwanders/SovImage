"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSetup } from "@/lib/stores/setup";
import { sweepOrphanImages } from "@/lib/gc";
import { SplashScreen } from "./SplashScreen";

export function SplashGate({ children }: { children: React.ReactNode }) {
  const phase = useSetup((s) => s.phase);
  const bootstrap = useSetup((s) => s.bootstrap);
  const startDownload = useSetup((s) => s.startDownload);

  useEffect(() => {
    bootstrap();
    // Fire-and-forget orphan image cleanup on boot. Safe to run alongside
    // setup; orphans only exist post-cancel, never racing the downloader.
    sweepOrphanImages().catch(() => {});
  }, [bootstrap]);

  useEffect(() => {
    if (phase === "idle") startDownload();
  }, [phase, startDownload]);

  const ready = phase === "ready";

  return (
    <>
      <AnimatePresence>
        {!ready && (
          <motion.div
            key="splash"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-50"
          >
            <SplashScreen />
          </motion.div>
        )}
      </AnimatePresence>
      <div aria-hidden={!ready} className={ready ? "" : "pointer-events-none"}>
        {children}
      </div>
    </>
  );
}

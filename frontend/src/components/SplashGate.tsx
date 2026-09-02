"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSetup } from "@/lib/stores/setup";
import { sweepOrphanFiles } from "@/lib/gc";
import { useToasts } from "@/lib/stores/toasts";
import { migrateLocalStorage } from "@/lib/storage";
import { SplashScreen } from "./SplashScreen";

export function SplashGate({ children }: { children: React.ReactNode }) {
  const phase = useSetup((s) => s.phase);
  const bootstrap = useSetup((s) => s.bootstrap);
  const pushToast = useToasts((s) => s.push);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageAttempt, setStorageAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void migrateLocalStorage()
      .then(() => {
        if (cancelled) return;
        setStorageError(null);
        setStorageReady(true);
        void bootstrap().catch(() => {});
        void sweepOrphanFiles()
          .then((result) => {
            if (result.failed) {
              pushToast("Some unused image files could not be cleaned up.");
            }
          })
          .catch((error) =>
            pushToast(`Could not clean up unused images: ${String(error)}`),
          );
      })
      .catch((error) => {
        if (!cancelled) {
          setStorageError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bootstrap, pushToast, storageAttempt]);

  const ready = storageReady && phase === "ready";

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
            {storageError ? (
              <div className="h-full w-full flex items-center justify-center bg-background p-8">
                <div
                  role="alert"
                  className="glass-panel rounded-2xl p-8 max-w-md text-center flex flex-col gap-4"
                >
                  <h2 className="text-lg font-semibold">Storage migration stopped</h2>
                  <p className="text-xs text-muted-text break-words">{storageError}</p>
                  <p className="text-xs text-muted-text">
                    No file was overwritten. Files already moved remain in
                    SovImage&apos;s local storage, and retry resumes safely after you
                    resolve the reported issue.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setStorageError(null);
                      setStorageAttempt((attempt) => attempt + 1);
                    }}
                    className="self-center rounded-full px-4 py-1.5 text-xs font-medium bg-accent text-background"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : (
              <SplashScreen />
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {ready && <div>{children}</div>}
    </>
  );
}

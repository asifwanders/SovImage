"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[sovimage] unrecoverable UI error", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground flex items-center justify-center p-8">
        <main
          role="alert"
          className="glass-panel rounded-2xl max-w-md w-full p-6 space-y-4 text-center"
        >
          <h1 className="text-lg font-semibold">SovImage could not continue</h1>
          <p className="text-sm text-muted-text">
            Your local chats and images were not deleted. Retry the screen, or
            reload the app if the problem persists.
          </p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="glass-soft rounded-lg px-4 py-2 text-sm"
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

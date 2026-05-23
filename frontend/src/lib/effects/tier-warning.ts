"use client";

import { useEffect } from "react";
import { useSetup } from "@/lib/stores/setup";
import { useToasts } from "@/lib/stores/toasts";

// Module-scoped latch: ensures the tier-1 warning fires exactly once per
// process lifetime, even across StrictMode double-invoke, HMR, and the user
// navigating between views that all mount AppShell. Mirrors the
// `bootstrapped` flag in `stores/setup.ts`.
let warned = false;

const TIER_1_MESSAGE =
  "8 GB hardware detected. Expect 60–90 s per image; close other apps for best results.";

/**
 * One-shot side effect: when setup reaches `ready` on tier 1, push a single
 * non-blocking toast warning the user about expected generation latency.
 * Intentionally only watches `phase` + `tier`; user dismissal does not reset
 * the latch.
 */
export function useTierWarning(): void {
  const phase = useSetup((s) => s.phase);
  const tier = useSetup((s) => s.tier);
  const push = useToasts((s) => s.push);

  useEffect(() => {
    if (warned) return;
    if (phase !== "ready") return;
    if (tier !== 1) return;
    warned = true;
    push(TIER_1_MESSAGE);
  }, [phase, tier, push]);
}

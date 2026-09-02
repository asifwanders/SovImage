"use client";

import { useEffect } from "react";
import { useTheme } from "@/lib/stores/theme";

export function ThemeBootstrap() {
  const init = useTheme((s) => s.init);
  useEffect(() => {
    init();
  }, [init]);
  return null;
}

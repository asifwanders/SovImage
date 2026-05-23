"use client";

import { create } from "zustand";

type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
  toggle: () => void;
  init: () => void;
}

const KEY = "sovimage.theme";

function applyResolved(t: Theme): "light" | "dark" {
  const sysDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const resolved: "light" | "dark" =
    t === "system" ? (sysDark ? "dark" : "light") : t;
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(resolved);
  return resolved;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "system",
  resolved: "light",
  init: () => {
    if (typeof window === "undefined") return;
    const stored = (localStorage.getItem(KEY) as Theme | null) ?? "system";
    const resolved = applyResolved(stored);
    set({ theme: stored, resolved });

    // Attach unconditionally so a later `setTheme("system")` still reacts to
    // OS theme changes. The handler self-guards on `get().theme === "system"`.
    // The store is a process singleton; a single permanent listener is fine.
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (get().theme === "system") {
        const r = applyResolved("system");
        set({ resolved: r });
      }
    };
    mql.addEventListener("change", onChange);
  },
  setTheme: (t) => {
    localStorage.setItem(KEY, t);
    const resolved = applyResolved(t);
    set({ theme: t, resolved });
  },
  toggle: () => {
    const next = get().resolved === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
}));

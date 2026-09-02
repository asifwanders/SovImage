"use client";

import { useTierWarning } from "@/lib/effects/tier-warning";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  useTierWarning();
  return (
    <div className="h-screen w-screen flex bg-background text-foreground overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 h-full relative">{children}</main>
    </div>
  );
}

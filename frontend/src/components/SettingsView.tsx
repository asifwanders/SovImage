"use client";

import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { db } from "@/lib/db";
import { useTheme } from "@/lib/stores/theme";
import { cn } from "@/lib/utils";

async function pickDirectory(): Promise<string | null> {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

const TIERS = [
  { id: "auto", label: "Auto (recommended)", desc: "Detected at first launch." },
  { id: "1", label: "Tier 1 · Flux schnell Q4_0", desc: "Lowest VRAM. Fastest." },
  { id: "2", label: "Tier 2 · Flux schnell Q8_0", desc: "Balanced." },
  { id: "3", label: "Tier 3 · Flux dev Q8_0", desc: "Highest quality." },
] as const;

export function SettingsView() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const [tier, setTier] = useState<string>("auto");
  const [telemetry, setTelemetry] = useState(false);
  const [outputDir, setOutputDir] = useState("");

  useEffect(() => {
    (async () => {
      const driver = await db();
      const stored = await driver.settingGet("model.override");
      if (stored) setTier(stored);
      const tel = await driver.settingGet("telemetry.enabled");
      setTelemetry(tel === "true");
      const out = await driver.settingGet("output.directory");
      if (out) setOutputDir(out);
    })();
  }, []);

  const updateTier = async (id: string) => {
    setTier(id);
    const driver = await db();
    await driver.settingSet("model.override", id);
  };
  const updateTel = async (v: boolean) => {
    setTelemetry(v);
    const driver = await db();
    await driver.settingSet("telemetry.enabled", v ? "true" : "false");
  };

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <h1 className="text-xl font-semibold">Settings</h1>

        <Section title="Appearance">
          <Row label="Theme">
            <div className="flex gap-2">
              {(["light", "dark", "system"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={cn(
                    "glass-soft rounded-lg px-3 py-1.5 text-xs capitalize transition-colors",
                    theme === t
                      ? "border-accent text-accent"
                      : "hover:text-accent",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        <Section title="Model">
          <div className="flex flex-col gap-2">
            {TIERS.map((t) => (
              <button
                key={t.id}
                onClick={() => updateTier(t.id)}
                className={cn(
                  "glass-soft rounded-lg px-4 py-3 text-left transition-colors",
                  tier === t.id
                    ? "border-accent"
                    : "hover:border-accent/40",
                )}
              >
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-xs text-muted-text mt-0.5">{t.desc}</div>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Storage">
          <Row label="Output directory">
            <div className="flex items-center gap-2 max-w-[60%]">
              <code className="glass-soft rounded-lg px-2 py-1 text-[11px] text-muted-text truncate flex-1 min-w-0">
                {outputDir || "app_data/images"}
              </code>
              <button
                onClick={async () => {
                  const dir = await pickDirectory();
                  if (!dir) return;
                  setOutputDir(dir);
                  const driver = await db();
                  await driver.settingSet("output.directory", dir);
                }}
                className="glass-soft rounded-lg px-2 py-1 text-xs hover:text-accent transition-colors flex items-center gap-1 shrink-0"
                aria-label="Choose output directory"
                title="Choose"
              >
                <FolderOpen className="w-3 h-3" />
                Choose
              </button>
            </div>
          </Row>
        </Section>

        <Section title="Privacy">
          <Row label="Telemetry">
            <Toggle checked={telemetry} onChange={updateTel} />
          </Row>
          <p className="text-[11px] text-muted-text">
            Off by default. SovImage never sends prompts, images, or model
            output anywhere. Telemetry, if enabled, sends only anonymous crash
            counts.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel rounded-2xl p-5 flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-text">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "w-9 h-5 rounded-full relative transition-colors",
        checked ? "bg-accent" : "bg-panel-border",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all",
          checked ? "left-[18px]" : "left-0.5",
        )}
      />
    </button>
  );
}

"use client";

import { ExternalLink, GitBranch, Heart } from "lucide-react";
import Image from "next/image";

export function AboutView() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div className="glass-panel rounded-2xl p-8 flex flex-col items-center gap-4 text-center">
          <div
            className="w-[220px] h-[80px] relative"
            style={{ filter: "drop-shadow(0 0 24px rgba(0,185,160,0.25))" }}
          >
            <Image
              src="/logo-wordmark.png"
              alt="SovImage"
              fill
              sizes="220px"
              style={{ objectFit: "contain" }}
            />
          </div>
          <p className="text-sm text-muted-text max-w-md">
            Open-source, local AI image generation. Runs Flux.1 entirely on
            your device — no servers, no telemetry by default, no cloud.
          </p>
          <div className="text-[11px] text-muted-text">Version 0.1.0</div>
        </div>

        <section className="glass-panel rounded-2xl p-5 flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Links</h2>
          <LinkRow
            icon={<GitBranch className="w-3.5 h-3.5" />}
            label="Source code"
            href="https://github.com/asifwanders/SovImage"
          />
          <LinkRow
            icon={<ExternalLink className="w-3.5 h-3.5" />}
            label="Report a bug"
            href="https://github.com/asifwanders/SovImage/issues/new"
          />
        </section>

        <section className="glass-panel rounded-2xl p-5 flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Acknowledgements</h2>
          <ul className="text-xs text-muted-text flex flex-col gap-1">
            <li>Flux.1 — Black Forest Labs</li>
            <li>stable-diffusion.cpp — leejet et al.</li>
            <li>Tauri — Tauri Apps</li>
            <li>Next.js · React · Tailwind · Framer Motion</li>
          </ul>
        </section>

        <p className="text-[11px] text-muted-text text-center flex items-center justify-center gap-1.5">
          Made with <Heart className="w-3 h-3 text-accent" /> for the local-AI
          community.
        </p>
      </div>
    </div>
  );
}

function LinkRow({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 text-xs hover:text-accent transition-colors"
    >
      <span className="text-accent">{icon}</span>
      <span>{label}</span>
    </a>
  );
}

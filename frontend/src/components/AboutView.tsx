"use client";

import { Box, Cpu, Heart, Sparkles } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { EXTERNAL_LINKS, openExternal } from "@/lib/external";
import {
  readBuildProvenance,
  type BuildProvenance,
} from "@/lib/provenance";
import { useToasts } from "@/lib/stores/toasts";
import packageJson from "../../package.json";

const VERSION = packageJson.version;
const BUILD_TARGET = process.env.NEXT_PUBLIC_BUILD_TARGET ?? null;

const GithubIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.01c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.16 1.18a11.04 11.04 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.26 5.68.41.36.78 1.07.78 2.15v3.18c0 .31.21.67.8.55C20.71 21.39 24 17.08 24 12 24 5.65 18.85.5 12 .5Z" />
  </svg>
);

export function AboutView() {
  const pushToast = useToasts((state) => state.push);
  const [provenance, setProvenance] = useState<BuildProvenance | null>(null);
  useEffect(() => {
    void readBuildProvenance()
      .then(setProvenance)
      .catch((error) =>
        pushToast(
          `Could not read build information: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }, [pushToast]);

  return (
    <div className="h-full overflow-y-auto px-8 py-12">
      <div className="max-w-2xl mx-auto space-y-10">
        {/* Hero */}
        <div className="space-y-4 text-center">
          <div
            className="relative w-[220px] h-[154px] mx-auto"
            style={{ filter: "drop-shadow(0 0 24px rgba(0,185,160,0.25))" }}
          >
            <Image
              src="/logo-wordmark.png"
              alt="SovImage"
              fill
              sizes="220px"
              style={{ objectFit: "contain" }}
              priority
            />
          </div>
          <p
            className="text-lg leading-relaxed"
            style={{ color: "var(--muted-text)" }}
          >
            Private local inference. No prompt uploads.
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <span
              className="text-[11px] font-medium tracking-wide uppercase px-2 py-0.5 rounded-full"
              style={{
                color: "var(--accent)",
                background: "rgba(0,185,160,0.10)",
                border: "1px solid rgba(0,185,160,0.30)",
              }}
            >
              v{VERSION}
            </span>
          </div>
        </div>

        {/* What it does */}
        <section className="space-y-3">
          <h2 className="text-xl font-medium">What it does</h2>
          <p
            className="text-base leading-relaxed"
            style={{ color: "var(--foreground)", opacity: 0.85 }}
          >
            SovImage turns text prompts into images entirely on your own
            device. There are no
            API keys, no accounts, no upload of your prompt or output. Type a
            prompt, get a picture. The model lives on your disk; the work
            happens on your GPU.
          </p>
        </section>

        {/* How it works — 3 cards */}
        <section className="space-y-3">
          <h2 className="text-xl font-medium">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <HowCard
              icon={<Cpu className="w-4 h-4" />}
              title="Hardware probe"
              body="On first launch we measure unified memory or VRAM and pick a model profile that fits your machine."
            />
            <HowCard
              icon={<Sparkles className="w-4 h-4" />}
              title="Verified local model"
              body="Model weights are downloaded when needed, SHA-256 verified, then loaded through the bundled inference engine."
            />
            <HowCard
              icon={<Box className="w-4 h-4" />}
              title="Native Tauri shell"
              body="A lightweight Rust shell wraps the UI and the inference sidecar. No Electron, no Python runtime."
            />
          </div>
        </section>

        {/* Built on */}
        <section className="space-y-3">
          <h2 className="text-xl font-medium">Built on</h2>
          <div className="glass-panel rounded-2xl p-5">
            <ul className="text-sm leading-relaxed space-y-1.5">
              <Credit
                label="stable-diffusion.cpp"
                href="https://github.com/leejet/stable-diffusion.cpp"
                detail="C++ inference engine for diffusion models"
              />
              <Credit
                label="Tauri 2"
                href="https://tauri.app/"
                detail="Native desktop shell, Rust-backed"
              />
              <Credit
                label="Next.js"
                href="https://nextjs.org/"
                detail="React 19 + App Router (static export)"
              />
            </ul>
          </div>
        </section>

        {/* Open source */}
        <section className="space-y-3">
          <h2 className="text-xl font-medium">Open source</h2>
          <p
            className="text-base leading-relaxed"
            style={{ color: "var(--foreground)", opacity: 0.85 }}
          >
            SovImage&apos;s code is MIT-licensed and built in the open. Model
            files keep their own licenses. File issues, submit patches, or
            read the code &mdash; everything lives on GitHub.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <LinkButton
              href={EXTERNAL_LINKS.source}
              icon={<GithubIcon className="w-4 h-4" />}
              label="View on GitHub"
            />
            <LinkButton
              href={EXTERNAL_LINKS.issues}
              label="Report a bug"
            />
            <LinkButton
              href={EXTERNAL_LINKS.discussions}
              label="Discussions"
            />
            <LinkButton href={EXTERNAL_LINKS.privacy} label="Privacy Policy" />
            <LinkButton
              href={EXTERNAL_LINKS.notices}
              label="Third-Party Notices"
            />
          </div>
        </section>

        {/* Divider */}
        <hr style={{ borderColor: "var(--panel-border)" }} />

        {/* Footer */}
        <div
          className="text-xs text-center space-y-1 pb-2"
          style={{ color: "var(--muted-text)" }}
        >
          <p>
            v{VERSION}
            {BUILD_TARGET ? ` · ${BUILD_TARGET}` : ""}
            {provenance
              ? ` · ${provenance.channel} ${provenance.buildNumber} · engine ${provenance.engineCommit.slice(0, 7)}`
              : ""}
          </p>
          <p>
            Built with{" "}
            <Heart
              className="inline-block w-3.5 h-3.5 align-middle"
              style={{ color: "var(--accent)", fill: "var(--accent)" }}
            />{" "}
            for creators, offline after setup.
          </p>
        </div>
      </div>
    </div>
  );
}

function HowCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="glass-panel rounded-2xl p-4 flex flex-col gap-2">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center"
        style={{
          color: "var(--accent)",
          background: "rgba(0,185,160,0.10)",
          border: "1px solid rgba(0,185,160,0.25)",
        }}
        aria-hidden="true"
      >
        {icon}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs leading-relaxed text-muted-text">{body}</p>
    </div>
  );
}

function Credit({
  label,
  href,
  detail,
}: {
  label: string;
  href: string;
  detail: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <button
        type="button"
        onClick={() => void launch(href)}
        className="font-medium hover:text-accent transition-colors"
      >
        {label}
      </button>
      <span className="text-xs text-muted-text text-right">{detail}</span>
    </li>
  );
}

function LinkButton({
  href,
  icon,
  label,
}: {
  href: string;
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void launch(href)}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium glass-soft hover:text-accent transition-colors"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

async function launch(url: string) {
  try {
    await openExternal(url);
  } catch (error) {
    useToasts
      .getState()
      .push(
        `Could not open link: ${error instanceof Error ? error.message : String(error)}`,
      );
  }
}

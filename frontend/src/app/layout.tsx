import type { Metadata } from "next";
import "./globals.css";
import { ThemeBootstrap } from "@/components/ThemeBootstrap";
import { SplashGate } from "@/components/SplashGate";
import { AppShell } from "@/components/AppShell";
import { ToastHost } from "@/components/ToastHost";
import { MotionProvider } from "@/components/MotionProvider";

export const metadata: Metadata = {
  title: "SovImage",
  description: "Private, local AI image generation.",
  applicationName: "SovImage",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeBootstrap />
        <MotionProvider>
          <SplashGate>
            <AppShell>{children}</AppShell>
          </SplashGate>
          <ToastHost />
        </MotionProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Ubuntu } from "next/font/google";
import "./globals.css";
import { ThemeBootstrap } from "@/components/ThemeBootstrap";
import { SplashGate } from "@/components/SplashGate";
import { AppShell } from "@/components/AppShell";

const ubuntu = Ubuntu({
  variable: "--font-ubuntu",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SovImage",
  description: "Local AI image generation, powered by Flux.",
  applicationName: "SovImage",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${ubuntu.variable} antialiased`}>
        <ThemeBootstrap />
        <SplashGate>
          <AppShell>{children}</AppShell>
        </SplashGate>
      </body>
    </html>
  );
}

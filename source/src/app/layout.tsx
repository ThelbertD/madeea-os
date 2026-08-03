import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Shell from "@/components/Shell";
import LoginGate from "@/components/LoginGate";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MadeEA OS — Mission Control",
  description: "Your command center for Claude, OpenClaw, Hermes",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/*
          MadeEA brand type — DM Sans (body) and Cormorant Garamond (display)
          are the two faces used by MadeEA Hub. Caveat stays for the hand-script
          numerals/emphasis, JetBrains Mono for code, and Bricolage Grotesque
          remains loaded because a few views still name it directly.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300..800&family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&family=Caveat:wght@400;500;600&display=swap"
        />
      </head>
      {/* suppressHydrationWarning: browser extensions inject attributes on <body>
          (e.g. ColorZilla's cz-shortcut-listen) before React hydrates. */}
      <body className="min-h-full" suppressHydrationWarning>
        <div className="relative z-10">
          {/* The gate wraps Shell, not the other way round: the sidebar and its
              status probes should not render, or fire, before someone is in. */}
          <LoginGate>
            <Shell>{children}</Shell>
          </LoginGate>
        </div>
      </body>
    </html>
  );
}

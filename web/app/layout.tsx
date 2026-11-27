import type { Metadata, Viewport } from "next";
// Geist is bundled by next/font and served from our own origin at /_next/static/media, so the strict
// CSP (default-src 'self') stays untouched: no third-party font CDN, no render-blocking external request.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Buyer Co-Pilot | Secure property purchase workspace",
  description: "Direct-from-owner property purchases in Malaysia, with exact costs, plain-language risk checks and your approval at every step.",
  applicationName: "Buyer Co-Pilot",
  creator: "RYDETECH GLOBAL ENTERPRISE",
  robots: { index: false, follow: false }, // transaction workspace: never index
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches --bg so mobile browser chrome blends into the page in both themes.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#08111f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

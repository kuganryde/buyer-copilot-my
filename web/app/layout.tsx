import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Buyer Co-Pilot Malaysia",
  description: "Owner-direct property purchase co-pilot for Malaysia with human approval at every step.",
  robots: { index: false, follow: false }, // transaction workspace: never index
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

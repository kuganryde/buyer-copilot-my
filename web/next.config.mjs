// Security headers applied to every route. CSP forbids third-party script/connect origins:
// the browser only ever talks to this Next server, which proxies to the engine.
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' only for the dev server (React dev tooling); never in production builds.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Pin the workspace root: this app lives inside a larger repo and must not inherit its
// PostCSS/Tailwind config or lockfile (supply-chain isolation + reproducible builds).
const root = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  poweredByHeader: false,
  agentRules: false,
  reactStrictMode: true,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ],
    }];
  },
};
export default nextConfig;

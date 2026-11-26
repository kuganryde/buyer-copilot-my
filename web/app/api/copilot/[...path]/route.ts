// Backend-for-frontend proxy. The browser never sees engine or n8n tokens.
//
// Controls:
//  * strict path ALLOWLIST (no open proxy / SSRF),
//  * same-origin check on state-changing requests (CSRF),
//  * buyer identity resolved SERVER-SIDE and asserted to the engine via X-Buyer-Id,
//  * body size cap and upstream timeout,
//  * fail closed when auth is not configured.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8000";
const ENGINE_TOKEN = process.env.ENGINE_BUYER_PROXY_TOKEN ?? "";
const N8N_INTAKE_URL = process.env.N8N_INTAKE_URL ?? "";
const N8N_INTAKE_TOKEN = process.env.N8N_INTAKE_TOKEN ?? "";
const MAX_BODY = 256 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const ALLOW: Record<"GET" | "POST", RegExp[]> = {
  GET: [/^rules$/, /^directory$/, new RegExp(`^transactions/${UUID}$`)],
  POST: [
    /^calculate$/, /^vet$/, /^guardrails\/evaluate$/, /^interpret\/title-search$/, /^interpret\/explain$/,
    /^transactions$/, new RegExp(`^transactions/${UUID}/decisions$`), /^intake$/,
  ],
};

/**
 * Resolve the authenticated buyer. PRODUCTION: replace with verification of your IdP session
 * (e.g. Supabase Auth JWT via @supabase/ssr, or OIDC) — never trust a client-supplied id.
 * DEMO: a single fixed buyer, only when explicitly enabled.
 */
async function resolveBuyerId(_req: NextRequest): Promise<string | null> {
  if (process.env.COPILOT_DEMO_MODE === "true" && (process.env.COPILOT_ENV ?? "production") !== "production") {
    return process.env.DEMO_BUYER_ID ?? "demo-buyer-001";
  }
  return null; // fail closed until real authentication is wired in
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

async function forward(req: NextRequest, method: "GET" | "POST", path: string[]) {
  const joined = path.join("/");
  if (!ALLOW[method].some((re) => re.test(joined))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (method === "POST" && !sameOrigin(req)) {
    return NextResponse.json({ error: "csrf_rejected" }, { status: 403 });
  }
  const buyerId = await resolveBuyerId(req);
  if (!buyerId || !ENGINE_TOKEN) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: string | undefined;
  if (method === "POST") {
    body = await req.text();
    if (body.length > MAX_BODY) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  // Intake goes to n8n (starts the gate cycle); everything else to the engine.
  const isIntake = joined === "intake";
  if (isIntake && (!N8N_INTAKE_URL || !N8N_INTAKE_TOKEN)) {
    return NextResponse.json({ error: "workflow_not_configured" }, { status: 503 });
  }
  const qs = method === "GET" ? req.nextUrl.search : "";
  const target = isIntake ? N8N_INTAKE_URL : `${ENGINE_URL}/v1/${joined}${qs}`;
  const headers: Record<string, string> = { "content-type": "application/json", "x-request-id": crypto.randomUUID() };
  if (isIntake) headers["X-Copilot-Intake-Token"] = N8N_INTAKE_TOKEN;
  else {
    headers.authorization = `Bearer ${ENGINE_TOKEN}`;
    headers["x-buyer-id"] = buyerId;
  }

  try {
    const upstream = await fetch(target, {
      method, headers, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch {
    // Do not leak upstream hostnames/stack traces to the browser.
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, "GET", (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, "POST", (await ctx.params).path);
}

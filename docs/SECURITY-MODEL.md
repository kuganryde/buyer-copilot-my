# Security & Threat Model

[← Back to README](../README.md)

| Threat | Control |
|---|---|
| Cash or informal payment fraud | `CASH_BY_HAND` and unprotected personal transfers are **BLOCK**. Approval is impossible in the app **and** in the DB trigger. |
| Seller impersonation, encumbrances, Malay Reserve, short lease, no access, land-use mismatch | Guardrail rules with bilingual next steps. Machine-read title facts carry evidence snippets and require human verification. |
| Under-declaring price on Borang 14A | **BLOCK** when price is more than 10% below market value. Duty is always computed on the higher figure. |
| Gate skipping or a forged approval by a compromised worker | DB triggers: one-step stage advance only after a matching human decision; approvals append-only with UPDATE/DELETE/TRUNCATE refused; DB-computed SHA-256 chain that Python cross-verifies. n8n re-verifies before acting. |
| Cross-buyer data access (IDOR) | `FORCE ROW LEVEL SECURITY` with per-transaction `SET LOCAL app.buyer_id`. Engine returns 404, not 403, for other buyers' IDs. Tested under a non-superuser role. |
| SSRF through the resume URL | Engine only stores and POSTs URLs under `N8N_BASE_URL`; redirects disabled. |
| Token theft or misuse | Separate service, buyer-proxy, resume and intake secrets. Constant-time comparison. Engine refuses to boot with weak secrets. Browser holds no tokens. |
| CSRF, clickjacking, XSS | Same-origin check on POSTs, strict CSP, `frame-ancestors 'none'`, React escaping, `rel=noopener noreferrer`. |
| Replays and double clicks | Idempotency keys (unique in DB) plus `expected_version` optimistic concurrency |
| Prompt injection through documents | No LLM in the decision path. Parsing uses bounded regexes; uploaded text is never treated as instructions. |
| Denial of service | Body size caps, per-client rate limit, 5 s DB statement timeout, bounded retries |
| Supply chain | Exact version pins, lockfile, `npm ci --ignore-scripts`, pip-audit, npm audit, CycloneDX SBOM, Dependabot, non-root read-only containers |

**Before production (not built here):** real authentication in `resolveBuyerId()` (OIDC or
Supabase Auth); document upload to encrypted object storage via signed URLs (the schema stores
hashes only); a WAF or gateway rate limit; TLS everywhere (`sslmode=verify-full`); OpenTelemetry
exporter wiring; and a human pass to verify every directory URL and set `last_verified_date`.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

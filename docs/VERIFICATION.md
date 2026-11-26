# Verification Status

[← Back to README](../README.md)

*As of 26 November 2026. The CI badge on the README shows the live status of every push.*

## Passing

| Check | Result |
|---|---|
| Engine unit and API tests | **87 passed**, 93% coverage (CI gate: 85%) |
| PostgreSQL integration tests | 4 of the 87. They run against real PostgreSQL 16 under a non-superuser role and prove: the database-computed hash chain verifies in Python; skipped steps, approvals while a must-fix risk is open, and edits or deletes of decisions are refused; buyers can't see each other's data (row-level security) |
| Lint and security scans | ruff (with security rules) and bandit are clean |
| Dependency audit | `pip-audit --strict` and `npm audit` report no known vulnerabilities |
| Web | strict TypeScript check and production build pass |
| Browser checks (Chromium) | 20 checks against the production build, real engine and PostgreSQL: inline validation; success messages; Approve blocked by a must-fix risk, with the reason shown; correct singular/plural; reject confirmation; cancelling keeps the purchase open; no raw system codes on screen; spelled-out dates; Bahasa Melayu view; no horizontal overflow at 390 px; no console errors |

## Recent fixes

- **Security:** upgraded FastAPI 0.115 → 0.162.5 and Starlette 0.46.2 → 1.10.0. The first CI run found 7 known advisories in Starlette 0.46.2 (PYSEC-2026-161, 248, 249, 1941, 1942, 2280 and 2281).
- **Correctness:** the title-search reader no longer runs the "restriction in interest" text into the next line. Previously a bank charge on the following line could appear as part of the restriction. Two regression tests cover this.

## Not yet verified

- `n8n/workflow.json` passes structural tests but hasn't been imported into a live n8n instance.
- **Directory:** every seeded entry shows **Not checked yet**. The government sites couldn't be reached from the build environment, so no verification dates were invented.
- **English only:** the engine's risk explanations, n8n's next-step items and the directory summaries. The Bahasa Melayu copy needs a review by a native speaker who knows conveyancing before launch.
- **Production sign-in:** the hub runs in single-buyer demo mode until real authentication (OIDC or Supabase Auth) is added in `resolveBuyerId()`.

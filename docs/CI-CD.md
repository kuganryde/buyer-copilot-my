# CI/CD & Deployment

[← Back to README](../README.md)

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

1. **engine:** ruff (incl. security rules), bandit SAST, seed drift check, schema applied twice on a pgvector service, unit and RLS integration tests with an 85% coverage gate, pip-audit.
2. **web:** `npm ci --ignore-scripts`, strict typecheck, production build, `npm audit`, CycloneDX SBOM artifact.
3. **workflow-and-images:** workflow JSON validation; both Dockerfiles built.

Recommended promotion path: merge → build and sign images (cosign) → staging via GitOps
(Argo CD / Flux) → schema migrations applied by a pipeline job, never by hand → smoke test of the
HITL cycle → manual production approval. Infrastructure (managed Postgres, secrets, WAF) belongs
in Terraform with OPA/Conftest policies, for example to forbid public DB endpoints and require
encryption at rest.

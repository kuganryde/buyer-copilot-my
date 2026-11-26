# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security
- Upgraded FastAPI 0.115.12 → 0.162.5 and Starlette 0.46.2 → 1.10.0, fixing 7 known Starlette advisories (PYSEC-2026-161, 248, 249, 1941, 1942, 2280, 2281).
- Runtime dependencies are now pinned in `engine/requirements.txt`, which CI audits with `pip-audit --strict`.

### Fixed
- The title-search reader no longer runs "restriction in interest" text into the next line. A bank charge on the following line could previously appear inside the restriction.

### Changed
- CI uses `actions/checkout@v5`, `setup-python@v6` and `setup-node@v5` (Node 24 runtime).
- Documentation reorganised into `docs/`, with architecture diagrams and real screenshots.

## [0.1.0] — 2026-11-26

### Added
- **Rule engine:** exact `Decimal` calculation of transfer (MOT) and loan stamp duty, SRO 2023 legal fees, SST, RPGT retention and the first-home exemption. The Budget 2027 proposal is shown as a separate "not law yet" scenario.
- **Risk checks:** cash hand-overs, unverified titles, owner mismatch, caveats, Malay Reserve land, short leases, missing road access, land-use mismatch and under-declared prices.
- **Five approval steps:** a human must approve each one. Decisions are sealed with a SHA-256 hash chain, and PostgreSQL triggers enforce the rules.
- **Data protection:** row-level security keeps each buyer's data private, with least-privilege database roles.
- **n8n workflow:** pauses for each approval and re-verifies the decision record before acting.
- **One-page Buyer Command Hub:** English and Bahasa Melayu, with an approvals console, cost calculator, document checklist, title-search reader and official sources directory.
- **CI:** lint, SAST, tests including PostgreSQL integration, dependency audits, SBOM and container builds.

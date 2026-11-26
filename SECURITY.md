# Security Policy

Buyer Co-Pilot handles information about people's biggest purchase, so we treat security reports as a priority.

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Report privately through GitHub: go to the **Security** tab, then **Report a vulnerability**. This opens a private advisory that only the maintainers can see.

Please include:
- what you found and where (file, endpoint or screen);
- steps to reproduce, or a proof of concept;
- the impact you think it has (for example, one buyer reading another buyer's data).

## What to expect

| Step | Target |
|---|---|
| We confirm we've received your report | within 3 working days |
| We give you an initial assessment | within 10 working days |
| We fix critical issues | as fast as possible, usually within 30 days |

We'll keep you updated, and credit you in the advisory unless you'd rather stay anonymous.

## Scope

**In scope:** the engine API, database schema and triggers, n8n workflow, web hub and the CI configuration in this repository.

**Especially interested in:**
- skipping an approval step or forging a decision;
- reading another buyer's purchase;
- incorrect stamp duty or cost figures;
- getting the engine to contact hosts it shouldn't (SSRF);
- leaking a token or secret.

**Out of scope:** findings that need a compromised server or a stolen secret, denial-of-service by volume alone, and missing hardening in the demo sign-in mode. That mode is documented as not for production.

## Supported versions

Only the latest commit on `main` is supported.

The full threat model is in [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

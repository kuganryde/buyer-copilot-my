---
name: anti-vibe-ui-auditor
description: Audit, refactor and eliminate generic AI-generated ("vibe-coded") UI/UX patterns in React/Next.js, Tailwind, HTML/CSS. Use when building, reviewing or refactoring frontend interfaces, landing pages or dashboards, or when asked to "de-slop" a UI or make it production-grade.
---

# Anti-Vibe UI Auditor

## Workflow
1. Run the static audit: `python .claude/skills/anti-vibe-ui-auditor/scripts/vibe_audit.py web --fix-suggestions`
   Scans .tsx/.jsx/.html/.css/.vue/.svelte (and .ts copy files) for: default indigo/purple/violet palettes,
   sole-Inter typography, glassmorphism and neon glow, repeated 3-column feature grids, AI buzzword copy,
   emoji used as icons. Exit code is 1 when any HIGH finding remains.
2. Refactor across five pillars: typography, colour/surface discipline, layout variance,
   component and icon craft, copywriting.
3. Re-run the audit and confirm zero HIGH findings.

## Gotchas
- Never strip aria-* attributes or :focus-visible rings while simplifying visuals.
- Preserve responsive breakpoints and data bindings.
- If the project already has a brand palette or font stack, enforce it rather than inventing one
  (here: Ledger Navy / Assurance Teal, Geist; see web/app/globals.css and web/CONTENT_GUIDE.md).
- Honour repo constraints before skill suggestions: strict CSP (no third-party fonts/images/CDNs),
  exact-pinned dependencies, bilingual EN/BM copy in web/lib/copilot.ts.

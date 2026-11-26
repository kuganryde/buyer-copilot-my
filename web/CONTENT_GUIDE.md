# Buyer Co-Pilot — Content Guide

All user-facing copy lives in `lib/copilot.ts` (`T`, plus the `*_LABEL` maps). Every string has an
English and a Bahasa Melayu version. No copy is hard-coded in components.

## Voice

| Principle | We sound | We don't sound |
|---|---|---|
| Protective | "Pay only into the lawyer's client account." | "It is recommended that funds be remitted via…" |
| Plain | "Bank loan on the land (Gadaian)" | `has_existing_charge: true` |
| Honest | "Not law yet. Don't budget on this." | "Enjoy savings of RM9,075!" |
| Calm | "This step changed while you were reviewing it. We've loaded the latest version." | "Error 409: STALE_VERSION" |
| Humble | "General guidance, not legal advice." | "Guaranteed accurate" |

**Tone by moment.**
- **Must-fix risks and stopping a purchase:** serious and specific. Say what happens next.
- **Routine approvals:** brief.
- **Errors:** no blame, and always give a next step.
- **Success:** short past-tense confirmation, plus what happens next.

## Patterns

- **Buttons:** sentence case, `[verb] [object]`, 2–4 words. Examples: "Approve this step", "Calculate costs", "Read title search". Never use "Submit", "OK" or "Click here".
- **Section titles, navigation and field labels:** title case. Examples: "Your Approvals", "Purchase Price (RM)".
- **Card headings (H3+), helper text, messages:** sentence case.
- **Errors:** what happened, then why, then what to do. Example: "Can't reach the cost engine right now. We won't guess your figures. Try again in a minute."
- **Inline validation:** sits below the field, states the requirement and gives an example. Example: "Enter an amount in ringgit, like 450000 or 450000.50".
- **Disabled actions always explain why** and how to enable them. Example: "Tick all 3 warnings above to approve."
- **Irreversible actions** use an in-page confirmation with specific buttons: "Yes, stop purchase" / "Keep reviewing".
- **Empty states:** say why it's empty and what to do. Example: "No decisions yet. Each approval you make will appear here."
- **Badges:** 3 words maximum. All-caps is allowed only within that limit. Severity always pairs an icon with text, never colour alone.
- **Dates:** spell the month out, with no ordinals. Example: "26 November 2026".
- **Money:** "RM 1,234.00". It is always formatted from the engine's decimal string, never from a float.
- **Plurals:** keep separate singular and plural strings (`…1` / `…N`). Never write "warning(s)".

## Terminology (use exactly these)

| Say | Not | Define on first use |
|---|---|---|
| purchase | transaction, deal, case | — ("Transaction ID" only for the technical ID) |
| step | gate, stage, HITL | — |
| must-fix risk | blocker, BLOCK flag | — |
| warning | WARN flag | — |
| sale agreement (SPA) | S&P, contract | Yes |
| stamp duty on the transfer (MOT) | MOT duty | Yes |
| official title search (Carian Rasmi) | search, OTS | Yes |
| check code | hash, row_hash | Tooltip explains the seal |
| record intact | audit chain valid | — |
| set by law / estimate / proposal | GAZETTED / ESTIMATE / PROPOSED_PENDING_GAZETTE | Tooltip |

## Known gaps

- **Engine-generated risk messages** (`flag.message`, `flag.next_step`) and n8n's "After you approve" items are English only. Titles are bilingual. Next step: add `message_ms`/`next_step_ms` to `guardrails.py`, or key the copy by flag code here.
- **Directory summaries** in `db/directory_seed.json` are English only.
- **No readability scoring has been done** on the BM copy. Have a native speaker who knows conveyancing review it before launch.

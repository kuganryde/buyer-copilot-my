# Cost Rules (`MY-2026.11`)

[← Back to README](../README.md)

> **General guidance, not legal or tax advice.** Each rule carries its legal status and a review date in [`engine/copilot_engine/rules.py`](../engine/copilot_engine/rules.py). Confirm every figure with your lawyer.

| Rule | Implementation |
|---|---|
| MOT scale (citizens & PRs) | 1% / 2% / 3% / 4% bands on the **higher** of price or market value. Value rounded **up** to the next RM100 ("or fractional part thereof"). |
| Non-citizen, residential | 8% flat (from 1 Jan 2026) on the higher of price or market value. PRs use the scale. |
| Non-citizen, land | `max(scale, 4%)`, marked **ESTIMATE**, plus a **BLOCK** flag because State consent is required. |
| Loan agreement | 0.5%, per RM1,000 or part thereof |
| First-time buyer (current) | 100% MOT and loan duty exemption: citizen, never owned residential property, a house (not land), assessed value ≤ RM500k, SPA dated on or before 31 Dec 2027 |
| Budget 2027 (proposed) | SPAs 2027–2030: 100% relief up to RM500k, 50% for RM500,001–750,000. **Separate scenario only.** |
| SRO 2023 | 1.25% on the first RM500k (minimum RM500), 1% on the next RM7m, above that capped at 1%. Applies to both the SPA and the loan. Discount defaults to 0% and can't exceed the configured cap. |
| SST | 8% on legal fees |
| RPGT retention | 3% shown as **INFO**. It is part of the price, so it is not added to cash totals. |
| Estimates | Valuation, searches, registration, consent, survey, misc. disbursements (can be overridden per transaction) |

Unit tests are hand-computed from the statutory bands (`tests/test_calculator.py`), so a regression
can't "agree with itself".

## Worked example

A RM720,000 house, valued at RM700,000, with a RM630,000 loan. The buyer is a Malaysian citizen and the SPA is signed in January 2027.

| Item | Calculation | Amount |
|---|---|---|
| Transfer stamp duty (MOT) | 1% × 100k + 2% × 400k + 3% × 220k, on the higher of price and valuation | RM 15,600.00 |
| Loan stamp duty | 0.5% × 630,000 | RM 3,150.00 |
| Lawyer's fee, sale agreement (SRO 2023) | 1.25% × 500k + 1% × 220k | RM 8,450.00 |
| Lawyer's fee, loan (SRO 2023) | 1.25% × 500k + 1% × 130k | RM 7,550.00 |
| SST on lawyer's fees | 8% × 16,000 | RM 1,280.00 |
| Valuation gap paid in cash | 720k − 700k (banks lend on the lower figure) | RM 20,000.00 |
| Budget 2027 proposal (**not law yet**) | 50% relief on both duties (RM500,001–750,000 band) | saves RM 9,375.00 |

Every one of these figures is covered by a hand-computed unit test in [`engine/tests/test_calculator.py`](../engine/tests/test_calculator.py).

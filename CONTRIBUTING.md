# Contributing

Thanks for helping make owner-direct property purchases in Malaysia safer.

## Ground rules

1. **People's money is at stake.** Every change to a cost rule needs an official source and a hand-computed test.
2. **The buyer always decides.** Never add a feature that moves money, signs, files or approves on someone's behalf.
3. **Plain words, two languages.** All user-facing copy is bilingual (EN/BM) and follows the [content guide](web/CONTENT_GUIDE.md).
4. **Secure by default.** No secrets in code, no unpinned dependencies, no disabling of checks to make CI pass.

## Getting set up

Follow the [runbook](docs/RUNBOOK.md). Running the engine tests takes about a minute:

```bash
cd engine && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt && pip install -e ".[dev]"
pytest
```

## Making a change

1. Create a branch from `main`, for example `fix/restriction-parser` or `feat/sabah-land-office`.
2. Make your change, with tests.
3. Run the same checks CI runs:
   ```bash
   # engine
   ruff check copilot_engine tests && bandit -q -r copilot_engine -s B608 && pytest
   python ../scripts/gen_seed.py --check
   # web
   cd ../web && npm run typecheck && npm run build
   ```
4. Open a pull request using the template, and describe what changed for the **buyer**.

We use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.

## Changing a cost or legal rule

Use the **Rule change** issue form first. Then:

1. Update `engine/copilot_engine/rules.py`: bump `version`, set the legal basis, status and effective dates.
2. Add or update **hand-computed** tests in `engine/tests/test_calculator.py`. Never copy the engine's own output into a test.
3. Update the matching entry in `db/directory_seed.json`, then run `python scripts/gen_seed.py`.
4. Mark anything not yet gazetted as `PROPOSED_PENDING_GAZETTE`. Proposals must never change official totals.

## Changing wording

All copy lives in `web/lib/copilot.ts`. Read the [content guide](web/CONTENT_GUIDE.md) first, and update **both** English and Bahasa Melayu.

## Reporting security issues

Please don't use public issues. See [SECURITY.md](SECURITY.md).

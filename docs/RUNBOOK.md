# Local Setup & Runbook

[← Back to README](../README.md)

**Prerequisites:** Python 3.11+, Node 20.9+, PostgreSQL 15+ (pgvector optional), Docker (for compose).

### 1. Engine tests (no database needed)
```bash
cd engine
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
ruff check copilot_engine tests && bandit -q -r copilot_engine -s B608
pytest --cov                     # integration tests auto-skip without a DB
```

### 2. Database integration tests
```bash
createdb copilot
psql -d copilot -v ON_ERROR_STOP=1 -f ../db/schema.sql   # idempotent: safe to re-run
psql -d copilot -v ON_ERROR_STOP=1 -f ../db/seed.sql
psql -d copilot -c "CREATE ROLE copilot_it LOGIN PASSWORD 'it' IN ROLE copilot_app; GRANT USAGE ON SCHEMA public TO copilot_app;"
COPILOT_TEST_DATABASE_URL=postgresql://postgres@localhost/copilot \
COPILOT_TEST_APP_DATABASE_URL=postgresql://copilot_it:it@localhost/copilot pytest -m integration -v
```

### 3. Run the stack locally without Docker
```bash
# secrets (different values each)
export ENGINE_SERVICE_TOKEN=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))")
export ENGINE_BUYER_PROXY_TOKEN=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))")
export N8N_RESUME_TOKEN=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))")

# engine (omit DATABASE_URL for the in-memory store)
COPILOT_ENV=development DATABASE_URL=postgresql://copilot_it:it@localhost/copilot \
  uvicorn --factory copilot_engine.api:app_factory --port 8000

# web
cd ../web && npm ci && npm run build
COPILOT_ENV=development COPILOT_DEMO_MODE=true ENGINE_URL=http://127.0.0.1:8000 npm start
# open http://localhost:3100
```
To act as n8n by hand: call `POST /v1/vet` and then `POST /v1/transactions/{id}/gate` with
`Authorization: Bearer $ENGINE_SERVICE_TOKEN`. The transaction then shows as pending in the hub.

### 4. Full stack with Docker Compose
```bash
cp .env.example .env    # fill in every secret and pin N8N_VERSION
docker compose up -d --build
```
Then in the n8n editor (http://127.0.0.1:5678):
1. Import `n8n/workflow.json`.
2. Create these credentials and replace the `REPLACE_*` placeholders:
   - **Header Auth** `X-Copilot-Intake-Token`
   - **Header Auth** `X-Copilot-Resume-Token`
   - **Header Auth** `Authorization: Bearer <ENGINE_SERVICE_TOKEN>` for the engine HTTP nodes
   - **Postgres** as `copilot_automation`
3. Activate the workflow.

### 5. Changing a rule
Edit `engine/copilot_engine/rules.py` (bump `version`), update the hand-computed tests, update the
matching directory entry in `db/directory_seed.json`, run `python scripts/gen_seed.py`, and open a PR.
CI must be green before merge.

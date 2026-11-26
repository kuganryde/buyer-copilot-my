#!/usr/bin/env bash
# Runs once at first DB init (docker-entrypoint-initdb.d), AFTER schema.sql created the roles.
# psql variables (:'x') are quoted by psql itself — passwords cannot inject SQL.
set -euo pipefail
: "${COPILOT_APP_DB_PASSWORD:?required}" "${COPILOT_AUTOMATION_DB_PASSWORD:?required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_pw="$COPILOT_APP_DB_PASSWORD" -v auto_pw="$COPILOT_AUTOMATION_DB_PASSWORD" <<'SQL'
ALTER ROLE copilot_app LOGIN PASSWORD :'app_pw';
ALTER ROLE copilot_automation LOGIN PASSWORD :'auto_pw';
GRANT USAGE ON SCHEMA public TO copilot_app, copilot_automation;
CREATE DATABASE n8n;  -- n8n's own state kept apart from transaction data
SQL

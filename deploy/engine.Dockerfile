# syntax=docker/dockerfile:1
# Pin the base image by digest in production (Dependabot/Renovate keeps it fresh).
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
# Single source of pins (same file CI audits).
COPY engine/requirements.txt ./
RUN pip install --no-compile -r requirements.txt
COPY engine/copilot_engine ./copilot_engine
COPY db/directory_seed.json ./db/directory_seed.json
# Least privilege: non-root, read-only code.
RUN useradd --system --uid 10001 copilot && chown -R root:root /app && chmod -R a-w /app
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/healthz')"
CMD ["uvicorn", "--factory", "copilot_engine.api:app_factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-server-header"]

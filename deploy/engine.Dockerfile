# syntax=docker/dockerfile:1
# Pin the base image by digest in production (Dependabot/Renovate keeps it fresh).
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY engine/pyproject.toml ./
RUN pip install --no-compile fastapi==0.115.12 pydantic==2.11.4 httpx==0.28.1 uvicorn==0.34.2 \
      "psycopg[binary]==3.2.9" psycopg-pool==3.2.6
COPY engine/copilot_engine ./copilot_engine
COPY db/directory_seed.json ./db/directory_seed.json
# Least privilege: non-root, read-only code.
RUN useradd --system --uid 10001 copilot && chown -R root:root /app && chmod -R a-w /app
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/healthz')"
CMD ["uvicorn", "--factory", "copilot_engine.api:app_factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-server-header"]

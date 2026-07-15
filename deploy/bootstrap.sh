#!/usr/bin/env bash
# One-shot VPS bootstrap for KeepFlow / First Move.
# Run from inside the cloned repo:  bash deploy/bootstrap.sh
#
# Safe to run on a shared VPS: it only touches this project, binds to
# 127.0.0.1:8090, and never modifies other apps or system-wide config.
set -euo pipefail

PORT=8090

echo "==> Checking Docker…"
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed. Install it first, then re-run:"
  echo "  Debian/Ubuntu:  curl -fsSL https://get.docker.com | sudo sh"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: 'docker compose' (v2) not available. Install the compose plugin, then re-run."
  exit 1
fi

echo "==> Checking port ${PORT} is free…"
if ss -ltn 2>/dev/null | grep -q ":${PORT}\b"; then
  echo "ERROR: port ${PORT} is already in use (another app may have it)."
  echo "Edit the 'ports:' mapping in docker-compose.yml to a free port and re-run."
  exit 1
fi

echo "==> Preparing .env…"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    Created .env from .env.example (PAYMENTS_ENABLED=false — safe default)."
else
  echo "    .env already present — leaving it as-is."
fi

echo "==> Building and starting the container…"
docker compose up -d --build

echo "==> Waiting for health…"
for i in $(seq 1 15); do
  if curl -fsS "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    echo
    echo "==> HEALTHY. Response:"
    curl -s "http://localhost:${PORT}/health"; echo
    echo
    echo "Next: point a subdomain at this VPS and add the reverse-proxy block"
    echo "(deploy/Caddyfile.example or deploy/nginx-keepflow.conf.example),"
    echo "then: curl -s https://keepflow.<yourdomain>/health"
    exit 0
  fi
  sleep 2
done

echo "ERROR: service did not become healthy. Logs:"
docker compose logs --tail 40 keepflow
exit 1

#!/usr/bin/env bash
# Build + recreate the Podman stack from a clean slate.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local — copy from .env.example and fill SMTP/Jira values."
  exit 1
fi

echo "==> Stopping old stack (if any)"
podman-compose -f podman-compose.yml down || true

echo "==> Building images (no cache for backend so dist/scripts is fresh)"
podman-compose -f podman-compose.yml build --no-cache backend-api
podman-compose -f podman-compose.yml build frontend-app

echo "==> Starting stack"
podman-compose -f podman-compose.yml up -d

echo "==> Waiting for backend health"
for i in $(seq 1 40); do
  if curl -fsS --max-time 3 http://localhost:5001/api/v1/health >/dev/null 2>&1; then
    echo "Backend is up"
    break
  fi
  sleep 3
  if [[ "$i" -eq 40 ]]; then
    echo "Backend did not become healthy in time. Logs:"
    podman logs --tail 80 jira-backend-api || true
    exit 1
  fi
done

echo "==> Running verify-deploy"
chmod +x scripts/verify-deploy.sh scripts/send-monthly-report.sh
./scripts/verify-deploy.sh

echo
echo "Deploy complete."
echo "UI:      http://localhost:3000"
echo "API:     http://localhost:5001/api/v1/health"
echo "SMTP:    ./scripts/send-monthly-report.sh --smtp-test"
echo "Report:  ./scripts/send-monthly-report.sh"

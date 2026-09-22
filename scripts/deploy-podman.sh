#!/usr/bin/env bash
# Build + recreate the Podman stack.
#
# Default (laptop with build tools): build images locally then up.
# On VM with prebuilt images: use ./scripts/load-and-deploy-vm.sh instead,
# or pass --from-images.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

FROM_IMAGES=0
for arg in "$@"; do
  case "$arg" in
    --from-images) FROM_IMAGES=1 ;;
    -h|--help)
      echo "Usage: $0 [--from-images]"
      echo "  --from-images  skip build; load latest bundle + up --no-build"
      exit 0
      ;;
  esac
done

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local — copy from .env.example and fill SMTP/Jira values."
  exit 1
fi

if [[ "$FROM_IMAGES" == "1" ]]; then
  exec ./scripts/load-and-deploy-vm.sh
fi

COMPOSE=(podman-compose -f podman-compose.yml)
if ! command -v podman-compose >/dev/null 2>&1; then
  COMPOSE=(podman compose -f podman-compose.yml)
fi

echo "==> Stopping old stack (if any)"
"${COMPOSE[@]}" down || true

echo "==> Building images"
"${COMPOSE[@]}" build --no-cache backend-api
"${COMPOSE[@]}" build frontend-app

echo "==> Starting stack"
"${COMPOSE[@]}" up -d

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
echo
echo "To ship this build to a VM instead:"
echo "  ./scripts/build-and-scp.sh user@vm:/path/to/Jira-Dashboard-Automations"

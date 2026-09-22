#!/usr/bin/env bash
# Run ON THE VM after scp'ing a local image bundle.
# Loads prebuilt images and starts compose with --no-build.
#
# Usage:
#   ./scripts/load-and-deploy-vm.sh
#   ./scripts/load-and-deploy-vm.sh /path/to/jira-dashboard-images-YYYYMMDD.tgz
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local in ${ROOT_DIR}"
  echo "Copy .env.example → .env.local and fill SMTP/Jira values first."
  exit 1
fi

if [[ ! -f podman-compose.yml ]]; then
  echo "Missing podman-compose.yml"
  exit 1
fi

ENGINE=podman
if ! command -v podman >/dev/null 2>&1; then
  echo "podman is required on the VM"
  exit 1
fi
if ! command -v podman-compose >/dev/null 2>&1 && ! podman compose version >/dev/null 2>&1; then
  echo "podman-compose (or podman compose) is required on the VM"
  exit 1
fi

COMPOSE=(podman-compose -f podman-compose.yml)
if ! command -v podman-compose >/dev/null 2>&1; then
  COMPOSE=(podman compose -f podman-compose.yml)
fi

IMAGES_DIR="${ROOT_DIR}/build/images"
BUNDLE_ARG="${1:-}"

pick_latest_archive() {
  ls -1t "${IMAGES_DIR}"/jira-dashboard-images-*.tgz 2>/dev/null | head -n 1 || true
}

ARCHIVE="$BUNDLE_ARG"
if [[ -z "$ARCHIVE" ]]; then
  ARCHIVE="$(pick_latest_archive)"
fi
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "No image bundle found. Expected:"
  echo "  ${IMAGES_DIR}/jira-dashboard-images-*.tgz"
  echo "Or pass the archive path as argv1."
  exit 1
fi

EXTRACT_DIR="${IMAGES_DIR}/loaded-$(basename "$ARCHIVE" .tgz)"
mkdir -p "$EXTRACT_DIR"
echo "==> Extracting $(basename "$ARCHIVE")"
tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"

echo "==> Loading images into podman"
shopt -s nullglob
for tarfile in "${EXTRACT_DIR}"/*.tar; do
  echo "    podman load -i $(basename "$tarfile")"
  podman load -i "$tarfile"
done
shopt -u nullglob

# Ensure expected tags exist even if save used a different name
if [[ -f "${EXTRACT_DIR}/BACKEND_IMAGE.txt" ]]; then
  echo "    backend image ref: $(cat "${EXTRACT_DIR}/BACKEND_IMAGE.txt")"
fi
if [[ -f "${EXTRACT_DIR}/FRONTEND_IMAGE.txt" ]]; then
  echo "    frontend image ref: $(cat "${EXTRACT_DIR}/FRONTEND_IMAGE.txt")"
fi

# Pull redis only if missing (not shipped in the image bundle)
if ! podman image exists docker.io/library/redis:7-alpine && ! podman image exists redis:7-alpine; then
  echo "==> redis:7-alpine not found locally; pulling"
  podman pull docker.io/library/redis:7-alpine || podman pull redis:7-alpine
else
  echo "==> Using existing redis image on VM"
fi

echo "==> Recreating stack from prebuilt images (--no-build)"
"${COMPOSE[@]}" down || true
"${COMPOSE[@]}" up -d --no-build

echo "==> Waiting for backend health"
for i in $(seq 1 40); do
  if curl -fsS --max-time 3 http://localhost:5001/api/v1/health >/dev/null 2>&1; then
    echo "Backend is up"
    break
  fi
  sleep 3
  if [[ "$i" -eq 40 ]]; then
    echo "Backend did not become healthy. Logs:"
    podman logs --tail 80 jira-backend-api || true
    exit 1
  fi
done

chmod +x scripts/verify-deploy.sh scripts/send-monthly-report.sh || true
if [[ -x scripts/verify-deploy.sh ]]; then
  echo "==> verify-deploy"
  ./scripts/verify-deploy.sh || true
fi

echo
echo "VM deploy complete (prebuilt images)."
echo "UI:     http://localhost:3000"
echo "API:    http://localhost:5001/api/v1/health"
echo "SMTP:   ./scripts/send-monthly-report.sh --smtp-test"
echo "Report: ./scripts/send-monthly-report.sh"

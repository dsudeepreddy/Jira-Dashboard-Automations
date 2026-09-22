#!/usr/bin/env bash
# Build npm/shared + Podman images on your laptop, save tarballs, SCP to the VM.
#
# Usage:
#   ./scripts/build-and-scp.sh user@stg-sreaudit010:/root/Jira-Dashboard-Automations
#   ./scripts/build-and-scp.sh --with-redis user@host:/opt/jira-dashboard
#   VM_TARGET=user@host:/path ./scripts/build-and-scp.sh
#
# On the VM afterwards:
#   cd /path && ./scripts/load-and-deploy-vm.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

WITH_REDIS=0
TARGET="${VM_TARGET:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-redis) WITH_REDIS=1; shift ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      TARGET="$1"
      shift
      ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 [--with-redis] user@vm:/remote/path/to/Jira-Dashboard-Automations"
  exit 1
fi

REMOTE_SPEC="$TARGET"
REMOTE_HOST="${REMOTE_SPEC%%:*}"
REMOTE_PATH="${REMOTE_SPEC#*:}"
if [[ "$REMOTE_HOST" == "$REMOTE_SPEC" || -z "$REMOTE_PATH" ]]; then
  echo "Target must look like user@host:/absolute/or/relative/path"
  exit 1
fi

ENGINE="${CONTAINER_ENGINE:-}"
if [[ -z "$ENGINE" ]]; then
  if command -v podman >/dev/null 2>&1; then ENGINE=podman
  elif command -v docker >/dev/null 2>&1; then ENGINE=docker
  else
    echo "Need podman or docker installed locally."
    exit 1
  fi
fi

BACKEND_IMAGE="${BACKEND_IMAGE:-localhost/jira-dashboard-backend:latest}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-localhost/jira-dashboard-frontend:latest}"
REDIS_IMAGE="${REDIS_IMAGE:-docker.io/library/redis:7-alpine}"
TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
OUT_DIR="${ROOT_DIR}/build/images"
STAMP="$(date +%Y%m%d-%H%M%S)"
BUNDLE_DIR="${OUT_DIR}/bundle-${STAMP}"
mkdir -p "$BUNDLE_DIR"

echo "==> Engine: $ENGINE"
echo "==> Tag helper: $TAG"
echo "==> Sync shared + local npm build checks"
npm run sync:shared
(cd backend && npm run build)
npm run test:unit
(cd backend && npm run test:smtp)

echo "==> Building container images"
$ENGINE build -t "$BACKEND_IMAGE" -f backend/Dockerfile backend
$ENGINE build -t "$FRONTEND_IMAGE" -f Dockerfile .

# Also tag with git sha for traceability
$ENGINE tag "$BACKEND_IMAGE" "localhost/jira-dashboard-backend:${TAG}"
$ENGINE tag "$FRONTEND_IMAGE" "localhost/jira-dashboard-frontend:${TAG}"

echo "==> Saving image tarballs to $BUNDLE_DIR"
$ENGINE save -o "${BUNDLE_DIR}/jira-dashboard-backend.tar" "$BACKEND_IMAGE"
$ENGINE save -o "${BUNDLE_DIR}/jira-dashboard-frontend.tar" "$FRONTEND_IMAGE"

if [[ "$WITH_REDIS" == "1" ]]; then
  echo "==> Pulling + saving redis (for air-gapped VMs)"
  $ENGINE pull "$REDIS_IMAGE"
  $ENGINE save -o "${BUNDLE_DIR}/redis-7-alpine.tar" "$REDIS_IMAGE"
fi

echo "==> Packing deploy overlay (compose + scripts, no secrets)"
OVERLAY="${BUNDLE_DIR}/deploy-overlay"
mkdir -p "${OVERLAY}/scripts"
cp podman-compose.yml docker-compose.yml "${OVERLAY}/"
cp scripts/load-and-deploy-vm.sh scripts/verify-deploy.sh scripts/send-monthly-report.sh "${OVERLAY}/scripts/"
cp .env.example "${OVERLAY}/"
chmod +x "${OVERLAY}/scripts/"*.sh
printf '%s\n' "$TAG" > "${BUNDLE_DIR}/IMAGE_TAG.txt"
printf '%s\n' "$BACKEND_IMAGE" > "${BUNDLE_DIR}/BACKEND_IMAGE.txt"
printf '%s\n' "$FRONTEND_IMAGE" > "${BUNDLE_DIR}/FRONTEND_IMAGE.txt"

MANIFEST="${BUNDLE_DIR}/MANIFEST.txt"
{
  echo "built_at=${STAMP}"
  echo "git_tag=${TAG}"
  echo "backend_image=${BACKEND_IMAGE}"
  echo "frontend_image=${FRONTEND_IMAGE}"
  echo "engine=${ENGINE}"
  ls -lh "${BUNDLE_DIR}"/*.tar
} | tee "$MANIFEST"

ARCHIVE="${OUT_DIR}/jira-dashboard-images-${STAMP}.tgz"
echo "==> Creating ${ARCHIVE}"
tar -C "$BUNDLE_DIR" -czf "$ARCHIVE" .

echo "==> Ensuring remote directory ${REMOTE_PATH}"
ssh "$REMOTE_HOST" "mkdir -p '${REMOTE_PATH}/build/images' '${REMOTE_PATH}/scripts'"

echo "==> SCP bundle → ${REMOTE_SPEC}"
scp "$ARCHIVE" "${REMOTE_HOST}:${REMOTE_PATH}/build/images/"
scp podman-compose.yml docker-compose.yml "${REMOTE_HOST}:${REMOTE_PATH}/"
scp scripts/load-and-deploy-vm.sh scripts/verify-deploy.sh scripts/send-monthly-report.sh \
  scripts/deploy-podman.sh "${REMOTE_HOST}:${REMOTE_PATH}/scripts/"
ssh "$REMOTE_HOST" "chmod +x '${REMOTE_PATH}/scripts/'*.sh"

# Optional: push .env.local if present (ask via flag)
if [[ "${SCP_ENV_LOCAL:-0}" == "1" && -f .env.local ]]; then
  echo "==> SCP .env.local (SCP_ENV_LOCAL=1)"
  scp .env.local "${REMOTE_HOST}:${REMOTE_PATH}/.env.local"
fi

cat <<EOF

Local build + SCP complete.

On the VM run:
  ssh ${REMOTE_HOST}
  cd ${REMOTE_PATH}
  # first time: ensure .env.local exists (copy from .env.example)
  ./scripts/load-and-deploy-vm.sh

Bundle on VM:
  ${REMOTE_PATH}/build/images/$(basename "$ARCHIVE")

Tip: include redis tarball with --with-redis if the VM cannot pull from the internet.
Tip: SCP_ENV_LOCAL=1 $0 ...  to also copy .env.local
EOF

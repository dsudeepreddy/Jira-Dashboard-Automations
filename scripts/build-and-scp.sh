#!/usr/bin/env bash
# Build npm/shared + Podman images on your laptop, save tarballs, SCP to the VM.
#
# Usage:
#   ./scripts/build-and-scp.sh -i ~/.ssh/vm.pem user@stg-host:/root/Jira-Dashboard-Automations
#   ./scripts/build-and-scp.sh --identity /path/to/key user@host:/path
#   VM_SSH_KEY=~/.ssh/vm.pem VM_TARGET=user@host:/path ./scripts/build-and-scp.sh
#
# Redis is expected to already exist on the VM.
# On the VM afterwards:
#   cd /path && ./scripts/load-and-deploy-vm.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TARGET="${VM_TARGET:-}"
IDENTITY="${VM_SSH_KEY:-${SSH_IDENTITY:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--identity|--key)
      IDENTITY="${2:-}"
      if [[ -z "$IDENTITY" ]]; then
        echo "Missing path after $1"
        exit 1
      fi
      shift 2
      ;;
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
  echo "Usage: $0 [-i /path/to/vm.key] user@vm:/remote/path/to/Jira-Dashboard-Automations"
  exit 1
fi

REMOTE_SPEC="$TARGET"
REMOTE_HOST="${REMOTE_SPEC%%:*}"
REMOTE_PATH="${REMOTE_SPEC#*:}"
if [[ "$REMOTE_HOST" == "$REMOTE_SPEC" || -z "$REMOTE_PATH" ]]; then
  echo "Target must look like user@host:/absolute/or/relative/path"
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-o StrictHostKeyChecking=accept-new)
if [[ -n "$IDENTITY" ]]; then
  if [[ ! -f "$IDENTITY" ]]; then
    echo "SSH key not found: $IDENTITY"
    exit 1
  fi
  # OpenSSH refuses keys that are group/world-readable.
  chmod 600 "$IDENTITY" 2>/dev/null || true
  SSH_OPTS+=(-i "$IDENTITY")
  SCP_OPTS+=(-i "$IDENTITY")
  echo "==> Using SSH key: $IDENTITY"
fi

ssh_vm() { ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "$@"; }
scp_vm() { scp "${SCP_OPTS[@]}" "$@"; }

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
ssh_vm "mkdir -p '${REMOTE_PATH}/build/images' '${REMOTE_PATH}/scripts'"

echo "==> SCP bundle → ${REMOTE_SPEC}"
scp_vm "$ARCHIVE" "${REMOTE_HOST}:${REMOTE_PATH}/build/images/"
scp_vm podman-compose.yml docker-compose.yml "${REMOTE_HOST}:${REMOTE_PATH}/"
scp_vm scripts/load-and-deploy-vm.sh scripts/verify-deploy.sh scripts/send-monthly-report.sh \
  scripts/deploy-podman.sh "${REMOTE_HOST}:${REMOTE_PATH}/scripts/"
ssh_vm "chmod +x '${REMOTE_PATH}/scripts/'*.sh"

# Optional: push .env.local if present
if [[ "${SCP_ENV_LOCAL:-0}" == "1" && -f .env.local ]]; then
  echo "==> SCP .env.local (SCP_ENV_LOCAL=1)"
  scp_vm .env.local "${REMOTE_HOST}:${REMOTE_PATH}/.env.local"
fi

SSH_HINT=(ssh)
if [[ -n "$IDENTITY" ]]; then
  SSH_HINT+=(-i "$IDENTITY")
fi
SSH_HINT+=("$REMOTE_HOST")

cat <<EOF

Local build + SCP complete.

On the VM run:
  ${SSH_HINT[*]}
  cd ${REMOTE_PATH}
  # first time: ensure .env.local exists (copy from .env.example)
  ./scripts/load-and-deploy-vm.sh

Bundle on VM:
  ${REMOTE_PATH}/build/images/$(basename "$ARCHIVE")

Tip: SCP_ENV_LOCAL=1 $0 -i /path/to/key user@host:/path  to also copy .env.local
EOF

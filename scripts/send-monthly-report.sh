#!/usr/bin/env bash
# Immediately build/send the SRE Audit monthly report email.
# Prefer running inside the backend container (bypasses HTTP auth):
#
#   podman exec jira-backend-api node dist/scripts/sendMonthlyReport.js --dry-run
#   podman exec jira-backend-api node dist/scripts/sendMonthlyReport.js
#   podman exec jira-backend-api node dist/scripts/sendMonthlyReport.js --month 2026-08
#
# Or via HTTP once SYNC_API_TOKEN is set:
#
#   ./scripts/send-monthly-report.sh --http
#   ./scripts/send-monthly-report.sh --http --dry-run

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="container"
DRY_RUN=0
MONTH=""
TO=""
PROJECT=""
BASE_URL="${BACKEND_API_URL:-http://localhost:5001/api/v1}"
TOKEN="${SYNC_API_TOKEN:-${BACKEND_API_TOKEN:-}}"
CONTAINER="${BACKEND_CONTAINER:-jira-backend-api}"

usage() {
  cat <<'EOF'
Usage: scripts/send-monthly-report.sh [--http|--container] [--dry-run] [--month YYYY-MM] [--to email] [--project KEY]

  --container   Run Node CLI inside backend container (default, no auth needed)
  --http        Call POST /api/v1/reports/monthly on the API
  --dry-run     Build report only; do not send SMTP
  --month       Report month (default: previous calendar month)
  --to          Override recipients
  --project     Override project key
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --http) MODE="http"; shift ;;
    --container) MODE="container"; shift ;;
    --dry-run|--dryRun) DRY_RUN=1; shift ;;
    --month) MONTH="${2:-}"; shift 2 ;;
    --to) TO="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ "$MODE" == "container" ]]; then
  ARGS=()
  [[ "$DRY_RUN" == "1" ]] && ARGS+=(--dry-run)
  [[ -n "$MONTH" ]] && ARGS+=(--month "$MONTH")
  [[ -n "$TO" ]] && ARGS+=(--to "$TO")
  [[ -n "$PROJECT" ]] && ARGS+=(--project "$PROJECT")
  echo "Running inside ${CONTAINER}: node dist/scripts/sendMonthlyReport.js ${ARGS[*]:-}"
  if [[ ${#ARGS[@]} -gt 0 ]]; then
    exec podman exec "$CONTAINER" node dist/scripts/sendMonthlyReport.js "${ARGS[@]}"
  fi
  exec podman exec "$CONTAINER" node dist/scripts/sendMonthlyReport.js
fi

QUERY=""
[[ "$DRY_RUN" == "1" ]] && QUERY="dryRun=true"
URL="${BASE_URL%/}/reports/monthly"
[[ -n "$QUERY" ]] && URL="${URL}?${QUERY}"

BODY='{'
PARTS=()
[[ -n "$MONTH" ]] && PARTS+=("\"month\":\"${MONTH}\"")
[[ -n "$TO" ]] && PARTS+=("\"to\":\"${TO}\"")
[[ -n "$PROJECT" ]] && PARTS+=("\"projectKey\":\"${PROJECT}\"")
BODY+=$(IFS=,; echo "${PARTS[*]-}")
BODY+='}'

CURL_ARGS=(-sS -v --max-time 180 -X POST "$URL" -H "Content-Type: application/json" -d "$BODY")
if [[ -n "$TOKEN" ]]; then
  CURL_ARGS+=(-H "x-sync-token: ${TOKEN}")
else
  echo "WARNING: SYNC_API_TOKEN is empty. Production compose will return 401." >&2
fi

echo "POST ${URL}"
curl "${CURL_ARGS[@]}"
echo

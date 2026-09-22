#!/usr/bin/env bash
# Post-deploy verification for Podman stack + monthly mail.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CONTAINER="${BACKEND_CONTAINER:-jira-backend-api}"
BASE_URL="${BACKEND_API_URL:-http://localhost:5001/api/v1}"

echo "==> 1) Backend health"
curl -fsS --max-time 15 "${BASE_URL%/}/health" | tee /tmp/jira-health.json
echo

echo "==> 2) Email diagnostics from health payload"
node -e '
const fs=require("fs");
const h=JSON.parse(fs.readFileSync("/tmp/jira-health.json","utf8"));
console.log(JSON.stringify(h.email||h,null,2));
if(!h.email||!h.email.configured){console.error("FAIL: email not configured"); process.exit(2)}
'

echo "==> 3) Resolve tinyproxy from inside backend container"
podman exec "$CONTAINER" wget -qO- --timeout=5 http://tinyproxy:8888/ 2>/dev/null \
  && echo "tinyproxy HTTP reachable (or returned a proxy page)" \
  || echo "WARN: direct HTTP to tinyproxy failed (CONNECT may still work for SMTP)"

echo "==> 4) SMTP probe (no Jira)"
podman exec "$CONTAINER" node dist/scripts/sendMonthlyReport.js --smtp-test

echo "==> VERIFY OK"
echo "Next: ./scripts/send-monthly-report.sh   # full previous-month report"

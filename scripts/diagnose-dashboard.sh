#!/usr/bin/env bash
# Diagnose why dashboards fail while SMTP may still work.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BACKEND="${BACKEND_CONTAINER:-jira-backend-api}"
FRONTEND="${FRONTEND_CONTAINER:-jira-frontend-app}"
API="${BACKEND_API_URL:-http://localhost:5001/api/v1}"
UI="${UI_URL:-http://localhost:3000}"

echo "==> Containers"
podman ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'NAMES|jira-' || true
echo

echo "==> Backend health (host → :5001)"
if curl -fsS --max-time 20 "${API%/}/health?jira=1" -o /tmp/jira-health.json; then
  node -e '
    const h=JSON.parse(require("fs").readFileSync("/tmp/jira-health.json","utf8"));
    console.log(JSON.stringify({
      status: h.status,
      jira: h.jira,
      jiraReachable: h.jiraReachable,
      emailConfigured: h.email && h.email.configured,
      smtpProxy: h.email && h.email.proxy,
    }, null, 2));
  '
else
  echo "FAIL: backend health unreachable at ${API%/}/health"
fi
echo

echo "==> Backend /metrics (host → :5001, may take up to ~60s)"
START=$(date +%s)
CODE=$(curl -sS -o /tmp/jira-metrics.json -w "%{http_code}" --max-time 90 "${API%/}/metrics" || echo "curl_fail")
END=$(date +%s)
echo "http=${CODE} elapsed=$((END-START))s"
node -e '
  const fs=require("fs");
  try {
    const d=JSON.parse(fs.readFileSync("/tmp/jira-metrics.json","utf8"));
    console.log(JSON.stringify({
      detail: d.detail || d.title || d.error || null,
      code: d.code || null,
      issues: d.metrics && d.metrics.totalIssues,
      projects: (d.projects||[]).length,
    }, null, 2));
  } catch (e) { console.log("non-json or missing body"); }
' || true
echo

echo "==> Frontend BFF /api/jira (host → :3000)"
START=$(date +%s)
CODE=$(curl -sS -o /tmp/jira-bff.json -w "%{http_code}" --max-time 90 "${UI%/}/api/jira" || echo "curl_fail")
END=$(date +%s)
echo "http=${CODE} elapsed=$((END-START))s"
node -e '
  const fs=require("fs");
  try {
    const d=JSON.parse(fs.readFileSync("/tmp/jira-bff.json","utf8"));
    console.log(JSON.stringify({
      detail: d.detail || d.title || d.error || null,
      details: d.details || null,
      backendUrl: d.backendUrl || null,
      hint: d.hint || null,
      issues: d.metrics && d.metrics.totalIssues,
    }, null, 2));
  } catch (e) { console.log("non-json or missing body"); }
' || true
echo

echo "==> Frontend container → backend-api (internal)"
if podman exec "$FRONTEND" wget -qO- --timeout=15 http://backend-api:5000/api/v1/health >/tmp/jira-fe-to-be.json 2>/dev/null; then
  echo "OK: frontend can reach backend-api health"
  head -c 200 /tmp/jira-fe-to-be.json; echo
else
  echo "FAIL: frontend container cannot reach http://backend-api:5000/api/v1/health"
  echo "      Check Compose network and HTTP_PROXY inside frontend (should be empty)."
  podman exec "$FRONTEND" sh -c 'echo HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY BACKEND_API_URL=$BACKEND_API_URL' 2>/dev/null || true
fi
echo

echo "==> Proxy env inside containers (should be empty except SMTP_PROXY on backend)"
echo "-- backend --"
podman exec "$BACKEND" sh -c 'echo HTTP_PROXY=$HTTP_PROXY; echo HTTPS_PROXY=$HTTPS_PROXY; echo SMTP_PROXY=$SMTP_PROXY; echo JIRA_DOMAIN=$JIRA_DOMAIN; echo JIRA_HTTP_PROXY=$JIRA_HTTP_PROXY' 2>/dev/null || echo "backend exec failed"
echo "-- frontend --"
podman exec "$FRONTEND" sh -c 'echo HTTP_PROXY=$HTTP_PROXY; echo HTTPS_PROXY=$HTTPS_PROXY; echo BACKEND_API_URL=$BACKEND_API_URL' 2>/dev/null || echo "frontend exec failed"
echo

echo "==> Done. If /metrics fails but SMTP works: Jira egress is the problem (not mail)."
echo "    If /metrics OK but /api/jira fails: frontend BFF/proxy — rebuild frontend image."
echo "    Remove HTTP_PROXY/HTTPS_PROXY from .env.local; keep only SMTP_PROXY for mail."

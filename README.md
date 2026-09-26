# Jira Analytics Dashboard

Next.js UI plus an Express analytics API. The browser never talks to Jira. Metrics are computed on the server from changelog-aware cycle time, sprint velocity, and a paginated issue list.

```text
.
├── app/                         Next.js UI and /api/jira proxies
├── components/                  Dashboard widgets
├── lib/backendProxy.ts          Next.js → Express proxy
├── shared/                      Canonical metrics + API contract
├── backend/src/
│   ├── services/jiraClient.ts   Only Jira REST / Agile client
│   ├── controllers/             metrics, issues, sync, webhook
│   ├── shared/                  Copy of ../shared (keep in sync)
│   └── db/                      Percona snapshot + schema
├── tests/                       Unit tests + API contract tests
├── podman-compose.yml
└── docker-compose.yml
```

Edit analytics in `shared/`, then run `npm run sync:shared` (also runs on `backend` `dev` / `build` when `../shared` exists).

## Documentation

- Technical specification (architecture, APIs, metrics, ops): [docs/TECHNICAL.md](docs/TECHNICAL.md)
- Slide deck: [docs/project-overview-slides.html](docs/project-overview-slides.html)

## Data modes

| Mode | When | Header label |
| --- | --- | --- |
| Live Jira (`DB_ENABLED=false`) | Each dashboard load queries Jira | **Data refreshed** (this request) |
| Percona snapshot (`DB_ENABLED=true`) | Metrics read from the last successful `POST /api/v1/sync` | **Last snapshot sync** |

Reload is not a Percona sync. To persist a snapshot, enable the database and call `/api/v1/sync`.

## How metrics are defined

| Metric | Definition |
| --- | --- |
| Velocity | Story points (or issue count if points are missing) completed in recent **closed** sprints plus the **active** sprint. The dashed line is a rolling average of earlier sprints. If issues have no sprint membership, the chart falls back to completed work by ISO week (`YYYY-Www`). |
| Cycle time | First transition into an In Progress category → done. |
| Lead time | Created → done. |
| Throughput | Issues opened vs closed by calendar month (`2026-Jan` axis). Monthly throughput KPI averages the last six months of closures. |
| In-progress aging | Open *in-progress* issues only, bucketed 0–2d / 3–7d / 8–14d / 14d+. (Replaces the older “WIP aging” label.) |
| **SRE Audit Team SLA** | Days from first **Approved** → first **Under Validation**. Default target 7 days. Over-target tickets appear under **SRE Audit Team SLA breaches**. |
| **Compliance SLA** | Days from first **Under Validation** → **Done** / resolution. Default target 7 days. Over-target tickets appear under **Compliance SLA breaches**. |

Date filters apply to created date, except when a sprint is selected (the sprint is the window).

## Dashboard layout

1. **Hero KPIs** — Total Jira's, Open Jira's, Under Validation Jira's, Done Jira's  
2. **Secondary KPIs** — License / BU, Audit types, Applications, Monthly throughput  
3. **Portfolio health** (status mix) + **Delivery rhythm** (monthly opened vs closed)  
4. **Team load** (all assignees with open work) + **In-progress aging**  
5. **Work by audit type** (volume chart, outside the collapsible audit section)  
6. **Audit types** (collapsible) — stage completion, SRE Audit Team / Compliance SLA averages, **SRE Audit Team SLA breaches**, **Compliance SLA breaches** (scrollable tables)  
7. **Velocity** + **Time in status**  
8. **Issues** table — page sizes 10 / 25 / 50 / 100  

Excel export from the UI uses the same audit-type workbook layout (Summary + one sheet per audit type).

## Features

- Jira REST API v3 search with changelog, Agile sprints, `closedSprints`, retries, and `Retry-After`
- Incremental snapshot sync (`updated >= last_issue_updated_at`) plus `?full=true`
- Scheduled sync and optional Jira webhook
- Optional Percona XtraDB Cluster persistence and Redis cache
- Paginated issue drill-down; `/metrics` does not return the full issue array
- URL query filters (`projectKey`, `sprintId`, `issueType`, `startDate`, `endDate`, License/BU, application, epic, label)
- Prometheus text at `/api/v1/observability/metrics`
- Weekly SRE Audit stakeholder email (Monday 09:00 Asia/Kolkata by default) with HTML charts and a month-scoped Excel attachment

## Quick start

```bash
npm install
cd backend && npm install && cd ..
cp .env.example .env.local
```

Fill in `JIRA_DOMAIN`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`. Story points and sprint custom fields default to `customfield_10016` / `customfield_10020`; change them if your site uses different IDs. Set `JIRA_BOARD_ID` if Agile board discovery is too broad.

The Next.js proxy defaults to `http://localhost:5001/api/v1`. Point the backend at that published port:

```bash
cd backend && PORT=5001 npm run dev
npm run dev
```

UI: http://localhost:3000 · API: http://localhost:5001/api/v1/health

If you keep the backend on `5000`, set `BACKEND_API_URL=http://localhost:5000/api/v1` in `.env.local`.

## Podman / Compose

Ensure `.env.local` exists at the repo root (mail + Jira). Required mail block for PhonePe-style relay:

```bash
SMTP_HOST="smtp.phonepe.com"
SMTP_PORT="25"
SMTP_SECURE="false"
SMTP_REQUIRE_TLS="false"
SMTP_FROM="noreply@phonepe.com"
SMTP_PROXY="http://tinyproxy:8888"
MONTHLY_REPORT_TO="you@phonepe.com"
MONTHLY_REPORT_ENABLED="true"
MONTHLY_REPORT_WEEKDAY="1"
MONTHLY_REPORT_HOUR="9"
MONTHLY_REPORT_TIMEZONE="Asia/Kolkata"
SYNC_API_TOKEN="pick-a-long-secret"
```

If your working host curl uses `--ssl-reqd`, set `SMTP_REQUIRE_TLS="true"`.

Do **not** put `HTTP_PROXY` / `HTTPS_PROXY` in `.env.local` for tinyproxy — that breaks both Jira (Axios) and the Next.js BFF (`/api/jira`). Use `SMTP_PROXY` only for mail.

**Deploy (recommended):**

```bash
chmod +x scripts/*.sh
./scripts/deploy-podman.sh
```

**Build on laptop → SCP images to VM (no build on VM):**

```bash
# on laptop
chmod +x scripts/*.sh
./scripts/build-and-scp.sh -i ~/.ssh/your-vm.pem root@stg-sreaudit010:/root/Jira-Dashboard-Automations

# on VM
cd /root/Jira-Dashboard-Automations
# ensure .env.local exists
./scripts/load-and-deploy-vm.sh
./scripts/send-monthly-report.sh --smtp-test
```

Or manually:

```bash
podman-compose -f podman-compose.yml down
podman-compose -f podman-compose.yml build --no-cache backend-api
podman-compose -f podman-compose.yml up -d --build
./scripts/verify-deploy.sh
```

UI: `http://localhost:3000` · API: `http://localhost:5001/api/v1/health`

`podman-compose` maps hostname `tinyproxy` → host gateway so the backend container can use the VM’s tinyproxy for **SMTP only** (`SMTP_PROXY`). Do **not** set `HTTP_PROXY`/`HTTPS_PROXY` to tinyproxy — that used to hijack Jira HTTPS via Axios and break dashboards. Leave `JIRA_HTTP_PROXY` empty unless Atlassian itself must go through a proxy. Compose loads `.env.local`. Do not commit that file.

**Send mail immediately:**

```bash
./scripts/send-monthly-report.sh --smtp-test   # SMTP only (fast)
./scripts/send-monthly-report.sh              # full previous-month report
```

After enabling Percona (`DB_ENABLED=true`), wait for health `database.connected: true`, then:

```bash
curl -X POST http://localhost:5001/api/v1/sync -H "x-sync-token: $SYNC_API_TOKEN"
curl http://localhost:3000/api/jira
```

`POST /api/v1/sync?full=true` skips the lookback window. Incremental runs use `last_issue_updated_at` with a five-minute overlap.

## Tests

```bash
npm test                    # unit tests (analytics, comments, monthly report)
cd backend && npm run test:smtp && cd ..   # local SMTP + HTTP CONNECT proxy smoke
npm run test:api            # with the stack running
```

## Environment

See [`.env.example`](.env.example) for the full list. Important variables:

| Variable | Purpose |
| --- | --- |
| `JIRA_DOMAIN` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | Jira Cloud credentials (or `JIRA_OAUTH_TOKEN`) |
| `JIRA_STORY_POINTS_FIELD` / `JIRA_SPRINT_FIELD` | Custom field IDs |
| `JIRA_LOOKBACK_DAYS` / `JIRA_MAX_ISSUES` | Default search window and cap |
| `BACKEND_API_URL` | Next.js proxy target |
| `BACKEND_API_TOKEN` | Optional. Required on `/metrics` and `/issues` when set. The Next.js proxy forwards it. |
| `SYNC_API_TOKEN` | Protects `POST /api/v1/sync` and `POST /api/v1/webhooks/jira`. Required in production. |
| `SYNC_INTERVAL_MS` | Incremental sync interval. `0` disables the scheduler. First boot runs a full sync if no snapshot exists. |
| `STALE_AFTER_MS` | Snapshot older than this is marked stale (Percona mode only) |
| `DB_ENABLED` | Read/write Percona snapshot |
| `SMTP_HOST` / `SMTP_FROM` / `MONTHLY_REPORT_TO` | SMTP + stakeholder recipients for monthly email |
| `MONTHLY_REPORT_ENABLED` | Auto-send previous-month report every Monday at 09:00 (`MONTHLY_REPORT_WEEKDAY=1`, `MONTHLY_REPORT_HOUR=9`, `MONTHLY_REPORT_TIMEZONE=Asia/Kolkata`) |
| `MONTHLY_REPORT_DASHBOARD_URL` | Optional “Open dashboard” link in the email |

### Monthly report

Subject line: `SRE Audit Monthly Report — August 2026` (optional `· PROJECT`).

Auto-send: every **Monday at 09:00** in `MONTHLY_REPORT_TIMEZONE` (default `Asia/Kolkata`), covering the **previous calendar month**.

The HTML mail includes a short 1–2 line summary plus:

1. KPI cards (opened / closed / net / still open / on hold / under validation / SLA averages)  
2. Colorful HTML bar charts — overall throughput, opened/closed by audit type, top applications, **SRE Audit Team SLA** and **Compliance SLA** by audit type, open-work snapshot  
3. Outside-SLA ticket list (**SRE Audit Team SLA breaches** and **Compliance SLA breaches**)  

An Excel workbook (`.xlsx`) is attached using the **same layout as the dashboard export** (Summary + one sheet per audit type with tickets), scoped to issues opened or closed in that month. Column headers use the SRE Audit Team / Compliance SLA names.

**Send immediately (recommended on VM / Podman):**

```bash
# Preview exact HTML email (no SMTP) — works on current image via HTTP:
curl -sS --max-time 180 -X POST "http://localhost:5001/api/v1/reports/monthly?dryRun=true" \
  -H "x-sync-token: $SYNC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); open("monthly-report-preview.html","w").write(d["html"]); print(d["subject"], "→ monthly-report-preview.html")'
# open monthly-report-preview.html in a browser

# Optional month: -d '{"month":"2026-08"}'

# After redeploying backend with latest CLI, dry-run also writes HTML inside the container:
./scripts/send-monthly-report.sh --dry-run
podman cp jira-backend-api:/tmp/sre-audit-monthly-2026-08.html ./monthly-report-preview.html

# send for real
./scripts/send-monthly-report.sh
```

HTTP alternative (requires `SYNC_API_TOKEN` when `NODE_ENV=production`):

```bash
curl -sS -v --max-time 180 -X POST "http://localhost:5001/api/v1/reports/monthly?dryRun=true" \
  -H "x-sync-token: $SYNC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Jira webhooks can call `POST /api/v1/webhooks/jira?token=YOUR_SYNC_TOKEN`.

## Percona

Set `DB_ENABLED=true` and point `DB_HOST` at the approved HAProxy/ProxySQL writer. `DB_AUTO_CREATE=true` only when the user may create `DB_NAME`. After schema setup, drop `CREATE`/`ALTER` from the runtime user if policy requires it. Redis remains the cache; dashboard reads come from Percona after a successful sync.

## Security

- Jira tokens stay in server-side env vars; they are not in the client bundle
- Zod validates query params
- Sync is rate-limited and token-gated in production
- Logs are JSON with request IDs; do not log raw secrets

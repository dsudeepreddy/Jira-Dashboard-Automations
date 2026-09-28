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
| Live Jira (`DB_ENABLED` off) | Each dashboard load queries Jira | **Data refreshed** (this request) |
| Percona snapshot (`DB_ENABLED` on) | Metrics read from the last successful `POST /api/v1/sync` | **Last snapshot sync** |

Reload is not a Percona sync. To persist a snapshot, enable the database and call `/api/v1/sync`.

## How metrics are defined

| Metric | Definition |
| --- | --- |
| Velocity | Story points (or issue count if points are missing) completed in recent **closed** sprints plus the **active** sprint. The dashed line is a rolling average of earlier sprints. If issues have no sprint membership, the chart falls back to completed work by ISO week (`YYYY-Www`). |
| Cycle time | First transition into an In Progress category → done. |
| Lead time | Created → done. |
| Throughput | Issues opened vs closed by calendar month (`2026-Jan` axis). Monthly throughput KPI averages the last six months of closures. |
| In-progress aging | Open *in-progress* issues only, bucketed 0–2d / 3–7d / 8–14d / 14d+. (Replaces the older “WIP aging” label.) |
| **SRE Audit Team SLA** | Business days from first **Approved** → first **Under Validation** (Sat/Sun excluded). Default target 7 days. Over-target tickets appear under **SRE Audit Team SLA breaches**. |
| **Compliance SLA** | Business days from first **Under Validation** → **Done** / resolution (Sat/Sun excluded). Default target 7 days. Over-target tickets appear under **Compliance SLA breaches**. |

Date filters apply to created date, except when a sprint is selected (the sprint is the window).

## Dashboard layout

1. **Hero KPIs** — Total Jira's, Open Jira's, Under Validation Jira's, Done Jira's  
2. **Secondary KPIs** — License / BU, Audit Types, Applications, Monthly Throughput Jira's  
3. **Portfolio Health** (status mix) + **Delivery Rhythm** (monthly opened vs closed)  
4. **Team Load** (all assignees with open work) + **In-Progress Aging**  
5. **Work by Audit Type** (volume chart, outside the collapsible audit section)  
6. **Audit Types** (collapsible) — stage completion, SRE Audit Team / Compliance SLA averages, **SRE Audit Team SLA breaches**, **Compliance SLA breaches** (scrollable tables)  
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

Fill in `JIRA_DOMAIN`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` in `.env.local` (see [`.env.example`](.env.example)). Adjust `JIRA_STORY_POINTS_FIELD`, `JIRA_SPRINT_FIELD`, and `JIRA_BOARD_ID` if your Jira site uses different values.

The Next.js proxy expects the backend on the published API port. Start both:

```bash
cd backend && PORT=5001 npm run dev
npm run dev
```

- UI: `http://localhost:3000`
- API: `http://localhost:5001/api/v1/health`

If the backend listens on a different port, set `BACKEND_API_URL` in `.env.local` accordingly.

## Podman / Compose

Ensure `.env.local` exists at the repo root (Jira + optional mail). Typical mail-related variables (assign values only in `.env.local`, never commit them):

```bash
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_REQUIRE_TLS
SMTP_FROM
SMTP_PROXY
MONTHLY_REPORT_TO
MONTHLY_REPORT_ENABLED
MONTHLY_REPORT_WEEKDAY
MONTHLY_REPORT_HOUR
MONTHLY_REPORT_TIMEZONE
SYNC_API_TOKEN
```

If your SMTP relay requires STARTTLS, set `SMTP_REQUIRE_TLS`.

Do **not** put `HTTP_PROXY` / `HTTPS_PROXY` in `.env.local` for an SMTP-only proxy — that breaks both Jira (Axios) and the Next.js BFF (`/api/jira`). Use `SMTP_PROXY` only for mail.

**Deploy (recommended):**

```bash
chmod +x scripts/*.sh
./scripts/deploy-podman.sh
```

**Build on laptop → SCP images to VM (no build on VM):**

```bash
# on laptop
chmod +x scripts/*.sh
./scripts/build-and-scp.sh -i ~/.ssh/your-vm.pem user@your-vm:/path/to/Jira-Dashboard-Automations

# on VM
cd /path/to/Jira-Dashboard-Automations
# ensure .env.local exists (never commit it)
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

- UI: `http://localhost:3000`
- API: `http://localhost:5001/api/v1/health`

`podman-compose` can map a host-side SMTP proxy hostname for **SMTP only** (`SMTP_PROXY`). Do **not** set `HTTP_PROXY`/`HTTPS_PROXY` to that proxy. Leave `JIRA_HTTP_PROXY` unset unless Atlassian itself must go through a proxy. Compose loads `.env.local`. Do not commit that file.

**Send mail immediately:**

```bash
./scripts/send-monthly-report.sh --smtp-test   # SMTP only (fast)
./scripts/send-monthly-report.sh              # full previous-month report
```

After enabling Percona (`DB_ENABLED`), wait for health `database.connected: true`, then:

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

See [`.env.example`](.env.example) for the full list and placeholder format. Important variables (set values only in `.env.local`):

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
| `SMTP_PROXY` | Optional HTTP CONNECT proxy used only for SMTP |
| `MONTHLY_REPORT_ENABLED` | Enables the weekly auto-send scheduler |
| `MONTHLY_REPORT_WEEKDAY` / `MONTHLY_REPORT_HOUR` / `MONTHLY_REPORT_TIMEZONE` | Schedule slot (defaults documented in `.env.example`) |
| `MONTHLY_REPORT_DASHBOARD_URL` | Optional “Open Dashboard” link in the email |
| `DASHBOARD_PUBLIC_HOSTNAME` | Preferred hostname when the dashboard URL would otherwise show an IP |
| `NEXT_PUBLIC_GITLAB_URL` / `NEXT_PUBLIC_GITHUB_URL` / `NEXT_PUBLIC_DOCS_URL` | Docs icon in the dashboard header (also accepts `GITLAB_URL` / `GITHUB_URL`) |

### Monthly report

Subject line: `SRE Audit Monthly Jira Report — <Month YYYY>` (optional project suffix).

Auto-send: every configured weekday/hour in `MONTHLY_REPORT_TIMEZONE`, covering the **previous calendar month**. The scheduler retries during that hour if SMTP/Jira fails, and persists the last successful run key under `/app/data` so container restarts do not double-send.

**Required for delivery:** `MONTHLY_REPORT_ENABLED`, `SMTP_HOST`, `SMTP_FROM`, `MONTHLY_REPORT_TO` (and usually `SMTP_PROXY` on locked-down hosts). Verify with:

```bash
curl -sS http://localhost:5001/api/v1/health | python3 -m json.tool | less
# confirm email + monthlyReportSchedule fields look healthy
./scripts/send-monthly-report.sh --smtp-test
```

The HTML mail includes a short summary plus KPI cards, dual-series charts (opened/closed and SLA by audit type), top applications, and outside-SLA tickets. An Excel workbook is attached using the same layout as the dashboard export, scoped to that month.

**Send immediately (recommended on VM / Podman):**

```bash
# Preview HTML email (no SMTP)
curl -sS --max-time 180 -X POST "http://localhost:5001/api/v1/reports/monthly?dryRun=true" \
  -H "x-sync-token: $SYNC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); open("monthly-report-preview.html","w").write(d["html"]); print(d["subject"], "→ monthly-report-preview.html")'

# Optional month in the JSON body: {"month":"YYYY-MM"}

./scripts/send-monthly-report.sh --dry-run
./scripts/send-monthly-report.sh
```

HTTP alternative (requires `SYNC_API_TOKEN` when running in production):

```bash
curl -sS -v --max-time 180 -X POST "http://localhost:5001/api/v1/reports/monthly?dryRun=true" \
  -H "x-sync-token: $SYNC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Jira webhooks can call `POST /api/v1/webhooks/jira` with your sync token (header or query param).

## Percona

Enable `DB_ENABLED` and set `DB_HOST` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` in `.env.local`. Use `DB_AUTO_CREATE` only when the DB user may create the schema database. After schema setup, drop `CREATE`/`ALTER` from the runtime user if policy requires it. Redis remains the cache; dashboard reads come from Percona after a successful sync.

## Security

- Jira tokens stay in server-side env vars; they are not in the client bundle
- Zod validates query params
- Sync is rate-limited and token-gated in production
- Logs are JSON with request IDs; do not log raw secrets

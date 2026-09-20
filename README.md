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
| Throughput | Issues completed per ISO week. Forecast uses the last four weeks. |
| WIP aging | Open *in-progress* issues only, bucketed 0–2d / 3–7d / 8–14d / 14d+. |
| Forecast | Remaining open issues ÷ recent weekly throughput. |

Date filters apply to created date, except when a sprint is selected (the sprint is the window).

## Features

- Jira REST API v3 search with changelog, Agile sprints, `closedSprints`, retries, and `Retry-After`
- Incremental snapshot sync (`updated >= last_issue_updated_at`) plus `?full=true`
- Scheduled sync and optional Jira webhook
- Optional Percona XtraDB Cluster persistence and Redis cache
- Paginated issue drill-down; `/metrics` does not return the full issue array
- URL query filters (`projectKey`, `sprintId`, `issueType`, `startDate`, `endDate`)
- Prometheus text at `/api/v1/observability/metrics`
- Monthly SRE Audit stakeholder email (`POST /api/v1/reports/monthly`) with opened/closed by audit type, SLAs, and breach lists

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

```bash
podman compose -f podman-compose.yml up --build
```

Frontend is on `http://localhost:3000`, backend on `http://localhost:5001` (container port `5000`). Compose loads `.env.local`. Do not commit that file.

After enabling Percona (`DB_ENABLED=true`), wait for health `database.connected: true`, then:

```bash
curl -X POST http://localhost:5001/api/v1/sync
curl http://localhost:3000/api/jira
```

`POST /api/v1/sync?full=true` skips the lookback window. Incremental runs use `last_issue_updated_at` with a five-minute overlap.

## Tests

```bash
npm test          # unit tests, no Jira / no stack
npm run test:api  # with the stack running
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
| `MONTHLY_REPORT_ENABLED` | Auto-send previous month on `MONTHLY_REPORT_DAY` (UTC, default 1) |
| `MONTHLY_REPORT_DASHBOARD_URL` | Optional “Open dashboard” link in the email |

### Monthly report

Subject line: `SRE Audit Monthly Report — August 2026` (optional `· PROJECT`).

The HTML mail includes a short narrative plus:

1. Opened / closed / net change / still open  
2. On hold & under validation snapshot  
3. Opened & closed **by audit type**, with team & reviewer SLA averages for that month  
4. Top applications  
5. Open tickets outside usual team/reviewer SLA  

Preview without sending:

```bash
curl -X POST "http://localhost:5001/api/v1/reports/monthly?dryRun=true&month=2026-08" \
  -H "x-sync-token: $SYNC_API_TOKEN"
```

Send for real (uses `MONTHLY_REPORT_TO`):

```bash
curl -X POST "http://localhost:5001/api/v1/reports/monthly" \
  -H "x-sync-token: $SYNC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"month":"2026-08"}'
```

Jira webhooks can call `POST /api/v1/webhooks/jira?token=YOUR_SYNC_TOKEN`.

## Percona

Set `DB_ENABLED=true` and point `DB_HOST` at the approved HAProxy/ProxySQL writer. `DB_AUTO_CREATE=true` only when the user may create `DB_NAME`. After schema setup, drop `CREATE`/`ALTER` from the runtime user if policy requires it. Redis remains the cache; dashboard reads come from Percona after a successful sync.

## Security

- Jira tokens stay in server-side env vars; they are not in the client bundle
- Zod validates query params
- Sync is rate-limited and token-gated in production
- Logs are JSON with request IDs; do not log raw secrets

# Jira Analytics Dashboard — Technical Documentation

**Document type:** System design and operations  
**Scope:** Entire repository (`Jira-Dashboard-Automations`)  
**Audience:** Engineers deploying, extending, or operating the dashboard  

This document describes how the system is built, how data moves, how every metric is defined, and how to run, secure, and test it. Behaviour described here is taken from the current source, not from a target-state design.

Related materials:

- Quick start: [README.md](../README.md)
- Slide overview: [project-overview-slides.html](./project-overview-slides.html)
- Environment template: [../.env.example](../.env.example)

---

## 1. Purpose

The product is an **operations analytics dashboard** over Jira Cloud. It answers:

- How much work is in flight, blocked, or aging?
- How long does work take (cycle time vs lead time)?
- What is sprint velocity and weekly throughput?
- When might remaining open work finish, given recent throughput?

It is **not** a Jira replacement, a workflow engine, or a general reporting warehouse. Jira remains the system of record. This service **reads** Jira, **computes** aggregates on the server, and **renders** them in a browser that never holds a Jira token.

Design constraints that drive the architecture:

1. Jira credentials must stay server-side.
2. Dashboard payloads must not dump every issue into the client.
3. Metric definitions must be shared by UI types and API code (one `shared/` module).
4. Live Jira on every page load is acceptable for small projects; larger ones need a **Percona snapshot** plus incremental sync.

---

## 2. System overview

```text
  Browser (React)
       │  same-origin fetch  /api/jira  /api/jira/issues
       ▼
  Next.js  :3000
       │  server-side proxy  BACKEND_API_URL
       ▼
  Express  :5000  (published :5001 in Compose)
       │
       ├── Redis (optional cache of Jira metadata)
       ├── Percona / MySQL (optional snapshot)  DB_ENABLED=true
       └── Jira Cloud
             REST API v3  /rest/api/3
             Agile API    /rest/agile/1.0
```

| Process | Role | Default listen | Host (Compose) |
| --- | --- | --- | --- |
| `frontend-app` | Next.js UI + BFF proxy | 3000 | `http://localhost:3000` |
| `backend-api` | Analytics, Jira I/O, sync | 5000 | `http://localhost:5001` |
| `redis-cache` | Cache + LRU fallback | 6379 | `localhost:6379` |
| Percona | Not in Compose by default; org-provided writer | 3306 | `DB_HOST` |

The Next.js app **does not** call Jira. `lib/jira/jiraService.ts` exists only to fail if someone tries to read credentials there.

---

## 3. Repository map

| Path | Responsibility |
| --- | --- |
| `app/page.tsx` | Home route; `Suspense` around the dashboard (URL search params). |
| `app/layout.tsx` | Fonts (Inter, IBM Plex Mono), theme script, `ThemeProvider`. |
| `app/api/jira/route.ts` | GET proxy → Express `/metrics`. |
| `app/api/jira/issues/route.ts` | GET proxy → Express `/issues`. |
| `app/globals.css` | Design tokens, glass cards, ambient background. |
| `components/DashboardLayout.tsx` | Filters, metrics fetch, issue table, charts. |
| `components/*Chart*.tsx`, `FlowCharts.tsx` | Recharts widgets. |
| `components/GlassCard.tsx`, `MetricCard.tsx` | Visual primitives. |
| `lib/backendProxy.ts` | Shared proxy helper and `x-api-token` forwarding. |
| `shared/analytics.ts` | **Canonical** aggregation (cycle time, velocity, in-progress aging, SLAs). |
| `shared/slaLabels.ts` | User-facing SLA / chart label constants (dashboard, email, Excel). |
| `shared/dashboardContract.ts` | TypeScript contract for API JSON. |
| `backend/src/server.ts` | Express app, middleware, scheduled sync. |
| `backend/src/services/jiraClient.ts` | Only Jira HTTP client. |
| `backend/src/controllers/` | `metrics`, `issues`, `sync`. |
| `backend/src/db/` | Pool, schema, snapshot repository. |
| `backend/src/cache/redisClient.ts` | Redis + in-process LRU. |
| `backend/src/shared/` | **Copy** of `shared/` produced by `backend/scripts/sync-shared.cjs`. |
| `backend/src/config/env.ts` | Zod-parsed environment. |
| `tests/analytics.test.mjs` | Unit tests (no Jira). |
| `tests/api.test.mjs` | Contract tests against a running stack. |
| `docs/` | This documentation and the HTML slide deck. |

**Invariant:** edit metrics in `shared/`, then `npm run sync:shared`. Backend `dev` and `build` also copy when `../shared` exists. Docker **backend** context is `./backend` only, so the copy must already be in `backend/src/shared` before image build (or the copy no-ops if parent `shared/` is absent).

---

## 4. Frontend

### 4.1 Stack

- Next.js **16** (App Router), React **19**, TypeScript
- Tailwind CSS 3
- Recharts 3
- Inter (UI) and IBM Plex Mono (numeric / keys), with tabular nums and slashed zero
- Theme: `light` | `dark`, stored as `jira-theme` in `localStorage`; inline script in `layout.tsx` reduces flash

### 4.2 Pages and data loading

`DashboardLayout` is a client component. On filter change it:

1. Writes query string via `router.replace` (`projectKey`, `sprintId`, `issueType`, `startDate`, `endDate`).
2. `GET /api/jira?...` for the metrics payload (no `issues` array).
3. `GET /api/jira/issues?page=&pageSize=` for the table.

If metrics were loaded once, later filter changes **do not** swap the whole page for a skeleton (`if (!data) setLoading(true)`).

### 4.3 Proxy

`proxyBackendGet` in `lib/backendProxy.ts`:

- Base URL: `BACKEND_API_URL` or `http://localhost:5001/api/v1`
- Forwards query string
- Sends `x-api-token` when `BACKEND_API_TOKEN` or `SYNC_API_TOKEN` is set
- `cache: 'no-store'`
- Backend unreachable → **502** JSON `{ error, details }`

### 4.4 HTTP security headers (Next)

From `next.config.mjs` on all routes:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### 4.5 UI behaviour notes

- Sticky chrome: brand + filters in one header (avoids overlapping sticky bars).
- Cards do not use hover-lift animation (reduces layout flicker).
- Issue keys link to `{browseBaseUrl}/{key}` when Jira domain is configured.
- Flagged issues show a blocked chip.

---

## 5. Backend API

### 5.1 Process

Express 4, Helmet, CORS (`CORS_ORIGIN` comma-separated), JSON body limit 1 MB.

Global rate limit: **200 requests / 15 minutes**.  
Sync/webhook limiter: **10 requests / 15 minutes**.

Every request gets `x-request-id` (incoming header or UUID). Access logs are one JSON line on `finish` (`event: http_request`, method, path, status, `durationMs`). Do not log secrets.

### 5.2 Endpoints

Base path: `/api/v1`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | none | Liveness; Jira config **masked**; database ping. Defined both on `server.ts` and `routes/health.ts` (Redis + DB in the router). |
| GET | `/metrics` | `BACKEND_API_TOKEN` if set | Dashboard contract. **No** `issues` array. |
| GET | `/issues` | same | Paginated issues (`page`, `pageSize` max 100, default 25). |
| POST | `/sync` | `SYNC_API_TOKEN` or `BACKEND_API_TOKEN`; **required in production** | Snapshot pull. `?full=true` unbounded search. **202** + counts. |
| POST | `/webhooks/jira` | same as sync | Returns **202** immediately, then incremental sync in the background. Query `?token=` allowed (Jira webhooks). |
| GET | `/observability/metrics` | none | Prometheus text: `jira_api_requests_total`, `jira_api_errors_total`. |

Errors use a Problem-like JSON shape: `type`, `title`, `status`, `detail`, `code`, `requestId`.

Notable codes:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | Missing/wrong token |
| `SYNC_REQUIRED` | 503 | `DB_ENABLED` but no successful snapshot yet |
| `DATABASE_DISABLED` | 503 | Sync called with DB off |
| `JIRA_*` | 4xx/5xx | Jira client failures |

### 5.3 Metrics query parameters

Validated with Zod:

| Query | Type | Notes |
| --- | --- | --- |
| `projectKey` | string | Jira project key |
| `sprintId` | positive int | Sprint membership |
| `issueType` | string | Issue type **name** |
| `startDate` / `endDate` | `YYYY-MM-DD` | Applied to **created** unless `sprintId` is set |

### 5.4 Metrics response `meta`

| Field | Live Jira | Percona |
| --- | --- | --- |
| `persistence` | `jira-direct` | `percona` |
| `lastSuccessAt` / `lastSyncedAt` | this request (`fetchedAt`) | `jira_sync_state` timestamps |
| `stale` | always `false` | true if last success older than `STALE_AFTER_MS` (default 30 min) |
| `truncated` | `issueCount >= JIRA_MAX_ISSUES` | `issueCount >= 10000` (repository cap) |
| `browseBaseUrl` | `{JIRA_DOMAIN}/browse` | same |
| `fetchedAt` | ISO now | ISO now |

UI copy: live mode → **Data refreshed**; snapshot → **Last snapshot sync**.

---

## 6. Jira integration

Implemented only in `backend/src/services/jiraClient.ts`.

### 6.1 Authentication

1. If `JIRA_OAUTH_TOKEN` is set → `Authorization: Bearer …`
2. Else if `JIRA_EMAIL` + `JIRA_API_TOKEN` → HTTP Basic (email:token)
3. Else → client throws `JIRA_AUTH_ERROR` (401)

### 6.2 Resilience

- 30s timeout
- Retry up to 3 extra attempts on **429** and **5xx**
- Honours `Retry-After` seconds; otherwise exponential backoff capped at 10s

### 6.3 Calls

| Method | API | Cache key |
| --- | --- | --- |
| `getProjects` | `GET /rest/api/3/project/search` | `jira:projects` |
| `getBoards` | `GET /rest/agile/1.0/board` | none (max 50) |
| `getSprints` | `GET /board/{id}/sprint` | `jira:sprints` |
| `getIssueTypes` | `GET /rest/api/3/issuetype` | `jira:issueTypes` |
| `getIssueStatuses` | `GET /rest/api/3/status` | `jira:statuses` |
| `searchIssues` | `POST /rest/api/3/search/jql` | none (paginated) |

Sprint boards: `JIRA_BOARD_ID` if set; otherwise first **8** boards from Agile search.

### 6.4 Issue search JQL

Built from filters:

- `project = "KEY"` from filter or `JIRA_PROJECT_KEY`
- `sprint = id`
- `issuetype = "Name"`
- created range if both dates set
- else `updated >= "{updatedSince}"` for incremental sync
- else `updated >= -{JIRA_LOOKBACK_DAYS}d` unless `unbounded: true` (full sync)

Pagination: `nextPageToken`, page size `min(JIRA_PAGE_SIZE, 100)`, stop at `JIRA_MAX_ISSUES` (default 1000, max 10000).

Fields requested include summary, status, type, dates, project, priority, assignee, labels, flagged, story points field, sprint field, `sprint`, `closedSprints`. Expand: **`changelog`**.

### 6.5 Mapping

- Story points: `JIRA_STORY_POINTS_FIELD` (default `customfield_10016`)
- Sprints: custom field + `sprint` + `closedSprints`; GreenHopper string form (`id=`, `state=`) is parsed; state lowercased
- Flagged: Jira flagged field or labels matching `flagged|blocked`, or status name containing `block`
- `inProgressAt` / `lastStatusChangedAt`: first changelog status change into category `indeterminate`; if resolved with no in-progress transition, in-progress falls back to **created**

---

## 7. Analytics (source of truth)

File: `shared/analytics.ts`  
Function: `aggregateDashboardMetrics(issues, sprints, filters, statusLookup, now)`

Status categories: Jira `statusCategory.key` when present (`new` | `indeterminate` | `done`), else name heuristics (`Done`/`Closed`/`Complete`, In Progress/Review, To Do/Backlog, Blocked → in progress).

**Done** if `resolved` is set **or** category is `done`.

| Metric | Rule |
| --- | --- |
| Completion rate | done / total × 100, 1 decimal |
| Cycle time | `inProgressAt` (or created) → completion date; mean days |
| Lead time | created → completion date; mean days |
| Completion date | `resolved`, else last status change if done |
| Throughput chart | created and closed counts by **calendar month** (`2026-Jan`); last 12 months. Closed uses `resolved` → `doneAt` → last status change |
| Avg monthly throughput | mean of **closed** counts in the **last 6** months |
| Velocity (sprint basis) | For closed (`closed`/`complete`/`completeDate`) sprints (last 6) **plus active**; value = story points of done members if any issue has points, else issue count. `target` = mean of prior sprints in the series |
| Velocity (week basis) | Used when there are no sprints in the trend **or** no issue has `sprintIds`. Done work bucketed by ISO week of completion |
| `velocity` KPI | Last point of the trend series |
| In-progress aging | Open issues with category `indeterminate` only; age from in-progress / last status change / created; buckets 0–2d, 3–7d, 8–14d, 14d+ (UI title; formerly “WIP aging”) |
| Assignee load | All assignees with open work; stacked by current status |
| Time in status | Open issues; average days since last status change/updated/created; top 8 |
| Blocked | `flagged` or status matches `/block/i` |
| SRE Audit Team SLA | Approved → Under Validation (default target 7d). Breaches listed as **SRE Audit Team SLA breaches** |
| Compliance SLA | Under Validation → Done (default target 7d). Breaches listed as **Compliance SLA breaches** |

Filters: project, type, sprint IDs. If `sprintId` is set, **created date filters are ignored** (sprint is the window).

ISO week: UTC, Thursday-based week year (`isoWeekKey`).

---

## 8. Persistence (Percona / MySQL)

Enabled with `DB_ENABLED=true`. Protocol is MySQL (`mysql2`). Intended writer: HAProxy / ProxySQL in front of **Percona XtraDB Cluster**, not a random cluster node.

### 8.1 Startup

1. Optional `CREATE DATABASE` if `DB_AUTO_CREATE=true`
2. Apply `backend/src/db/schema.sql` statement-by-statement
3. `ensureColumn` for columns added after first deploy (`status_category`, `assignee`, `story_points`, `flagged`, `in_progress_at`, `last_status_changed_at`, `last_issue_updated_at`)

Pool: `DB_CONNECTION_LIMIT` (default 10), `timezone: 'Z'`, SSL default **on** (`DB_SSL`, `DB_SSL_VERIFY`).

### 8.2 Tables

| Table | Role |
| --- | --- |
| `jira_projects` | Project dimension |
| `jira_sprints` | Sprint dimension |
| `jira_issue_types` | Types |
| `jira_statuses` | Status + category |
| `jira_issues` | Issue facts + optional `raw_json` |
| `jira_issue_sprints` | M:N membership |
| `jira_sync_state` | Single row `source_name = 'jira'` |

Issue list queries cap at **10 000** rows. Sprint filter uses `EXISTS` on `jira_issue_sprints`.

### 8.3 Sync algorithm (`runJiraSync`)

Requires DB. Loads projects, types, statuses, Agile sprints, previous sync state. Incremental unless `full` or no `last_issue_updated_at`: `updatedSince = last_issue_updated_at − 5 minutes`. Full sync sets `unbounded` so lookback JQL is omitted. Upsert is transactional. Clears Redis keys `jira:projects|sprints|issueTypes|statuses`. Failure writes `last_error` without clearing last success.

Scheduler (`SYNC_INTERVAL_MS`, default 900000 = 15 min): disabled if `0` or DB off. First tick is **full** if `last_success_at` is missing.

---

## 9. Cache

`RedisCacheClient`:

1. In-memory **LRU** (500 entries, TTL `CACHE_TTL_MS`, default 60s)
2. Redis `GET`/`SET PX` / `DEL` if connected (`REDIS_HOST` default `redis-cache`)

Redis outage: reads/writes degrade to LRU only; errors are not thrown to callers.

---

## 10. Security model

| Secret | Where it lives | Client bundle |
| --- | --- | --- |
| `JIRA_API_TOKEN` / `JIRA_OAUTH_TOKEN` | Backend env | No |
| `BACKEND_API_TOKEN` | Backend + Next **server** env for proxy | No (`NEXT_PUBLIC_*` not used for tokens) |
| `SYNC_API_TOKEN` | Backend | No |
| `DB_PASSWORD` / `REDIS_PASSWORD` | Backend | No |

Token transport: `x-api-token`, `x-sync-token`, `Authorization: Bearer`, or `?token=` (webhooks).

Production (`NODE_ENV=production`): sync/webhook **must** have `SYNC_API_TOKEN` or `BACKEND_API_TOKEN`.

Health responses mask credentials via `maskSecret`.

---

## 11. Configuration reference

Backend loads `process.env` then `../.env.local`. Next.js loads `.env.local` at the repo root.

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT` | 5000 | Backend listen (Compose overrides to 5000 in-container, host **5001**) |
| `JIRA_DOMAIN` | placeholder URL | Jira base |
| `JIRA_EMAIL` / `JIRA_API_TOKEN` | — | Basic auth |
| `JIRA_OAUTH_TOKEN` | — | Bearer auth |
| `JIRA_PROJECT_KEY` | — | Default JQL project |
| `JIRA_BOARD_ID` | — | Sprint board |
| `JIRA_STORY_POINTS_FIELD` | `customfield_10016` | Points |
| `JIRA_SPRINT_FIELD` | `customfield_10020` | Sprint custom field |
| `JIRA_LOOKBACK_DAYS` | 120 (max 730) | Default JQL window |
| `JIRA_MAX_ISSUES` | 1000 (max 10000) | Search cap |
| `JIRA_PAGE_SIZE` | 50 (max 100) | Jira page |
| `CACHE_TTL_MS` | 60000 | Redis/LRU |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | redis-cache / 6379 | Cache |
| `DB_ENABLED` | false | Snapshot mode |
| `DB_AUTO_CREATE` | false | Create schema DB |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | percona-proxy / 3306 / jira_analytics / … | MySQL |
| `DB_SSL` / `DB_SSL_VERIFY` | true / true | TLS to DB |
| `DB_CONNECTION_LIMIT` | 10 | Pool |
| `CORS_ORIGIN` | `http://localhost:3000` | CORS |
| `BACKEND_API_TOKEN` | — | Metrics/issues |
| `SYNC_API_TOKEN` | — | Sync/webhook |
| `SYNC_INTERVAL_MS` | 900000 | Scheduler; `0` off |
| `STALE_AFTER_MS` | 1800000 | Snapshot staleness |
| `BACKEND_API_URL` | `http://localhost:5001/api/v1` | Next proxy |
| `NEXT_PUBLIC_SITE_URL` | — | Site URL only (not Jira) |

Compose sets `BACKEND_API_URL=http://backend-api:5000/api/v1` for the frontend container so it does not use localhost.

**Port trap:** Next proxy defaults to host **5001**. Local backend default is **5000**. Run `PORT=5001 npm run dev` in `backend/` **or** set `BACKEND_API_URL` to port 5000.

---

## 12. Local and Compose runbooks

### 12.1 Local (two terminals)

```bash
npm install
cd backend && npm install && cd ..
cp .env.example .env.local
# fill JIRA_* 

cd backend && PORT=5001 npm run dev
npm run dev
```

UI: `http://localhost:3000`  
API: `http://localhost:5001/api/v1/health`

### 12.2 Podman / Docker

```bash
podman compose -f podman-compose.yml up --build
```

Services: Redis, backend, frontend. Percona is **not** started by this file; point `DB_HOST` at an existing cluster when enabling DB.

Snapshot mode:

1. `DB_ENABLED=true` and DB credentials in `.env.local`
2. Wait until health `database.connected` is true
3. `curl -X POST http://localhost:5001/api/v1/sync` (add token header in production)
4. Open the UI; header shows last snapshot time

Full refresh: `POST /api/v1/sync?full=true`

---

## 13. Testing

| Command | What | Needs |
| --- | --- | --- |
| `npm test` | Compiles `shared/*.ts` to `tests/.tmp`, runs `tests/analytics.test.mjs` | Node only |
| `npm run test:api` | Health, metrics contract (no `issues` dump), paginated issues, frontend proxy | Stack on 3000 and 5001 |

Override: `BACKEND_TEST_URL`, `FRONTEND_TEST_URL`.

Unit tests cover ISO weeks, status categories, changelog in-progress time, sprint velocity, and week fallback when sprint IDs are missing.

---

## 14. Observability

- **Logs:** stdout JSON (`http_request`, `server_started`, `scheduled_sync_*`, `webhook_sync_*`)
- **Tracing-ish:** `x-request-id` on every response
- **Prometheus:** process counters only (request and error totals), not Jira-specific histograms
- **Health:** use `/api/v1/health` for Compose probes (wget/curl to container port 5000)

Ship logs with the platform collector (Loki, CloudWatch, etc.). Never attach raw tokens.

---

## 15. Limits and known behaviours

- Search is capped (`JIRA_MAX_ISSUES` / 10k in DB). `meta.truncated` is the signal; narrow project/dates.
- Live mode issue pagination slices **in memory** after one search; snapshot mode pages in SQL.
- Changelog is only as complete as Jira returns (`expand=changelog`); missing histories understate cycle time.
- Story points field IDs differ by site; wrong field → velocity unit becomes `issues`.
- Duplicate `/health` handlers exist; both return 200. Prefer the router payload for Redis.
- Backend Docker build context does not include repo-root `shared/`; keep `backend/src/shared` committed or copy before `backend` image build.
- `NEXT_PUBLIC_BACKEND_API_URL` appears in Compose; the **server** proxy uses `BACKEND_API_URL`. Do not put tokens in `NEXT_PUBLIC_*`.

---

## 16. Extending the system

| Goal | Where |
| --- | --- |
| Change a metric formula | `shared/analytics.ts` + unit test + `npm run sync:shared` |
| Add a chart | New component + field already on `DashboardMetrics` or extend the contract |
| New Jira field | `jiraClient` mapIssue + schema column + repository upsert/select |
| New API route | `server.ts` + controller + Next proxy if the UI needs it |
| Auth at the edge | SSO reverse proxy in front of `:3000`; keep Jira tokens on the API |

---

## 17. Document control

This file should be updated when endpoints, metric definitions, environment variables, or data modes change. The README remains the short path to a running instance; this file is the specification.

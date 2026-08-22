# Jira Analytics Dashboard

A production-ready Jira analytics dashboard built with Next.js, TypeScript, Tailwind CSS, Recharts, and a secure Jira REST API integration layer.

## Directory Structure

```text
.
├── app/
│   ├── api/
│   │   └── jira/
│   │       └── route.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   └── jira/
│       ├── analytics.ts
│       ├── jiraService.ts
│       └── types.ts
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
├── docker-compose.yml
├── next.config.mjs
├── next-env.d.ts
├── package.json
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
├── public/
│   └── .gitkeep
└── .next/
```

## Features

- Secure Jira REST API v3 integration with environment-based credentials
- Dashboard metrics for issues, completion, velocity, and cycle time
- Status distribution, throughput trends, and velocity charts
- Reusable UI for filters, metrics cards, and chart panels
- Cache-aware request strategy with retry/backoff for Jira API rate limits
- Non-root multi-stage Docker image and Compose configuration

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy environment config:

```bash
cp .env.example .env.local
```

3. Fill in Jira connection details in `.env.local`:

```bash
JIRA_DOMAIN="https://your-company.atlassian.net"
JIRA_EMAIL="you@example.com"
JIRA_API_TOKEN="your-api-token"
```

4. Start the app locally:

```bash
npm run dev
```

Open http://localhost:3000.

## Production Build

```bash
npm run build
npm run start
```

## Podman

```bash
podman compose -f podman-compose.yml up --build
```

The stack publishes the frontend on `http://localhost:3000` and the backend on `http://localhost:5001` (the backend listens on port `5000` inside the network). The backend loads Jira credentials from `.env.local` for local Podman use. Do not commit that file.

## Tests

With the Podman stack running:

```bash
npm test
```

The integration tests verify backend health, the Jira metrics response contract, and the frontend proxy. Jira issue retrieval is paginated up to `JIRA_MAX_ISSUES` using `JIRA_PAGE_SIZE` per request. Rate-limit responses honor Jira's `Retry-After` header.

Operational metrics are available at `http://localhost:5001/api/v1/observability/metrics` in Prometheus text format. Backend request logs are JSON on stdout with request IDs; configure the container runtime or your deployment platform to forward stdout/stderr to Loki, Fluent Bit, CloudWatch, or the equivalent centralized collector.

## Percona XtraDB Cluster persistence

The backend supports Percona XtraDB Cluster through its MySQL protocol. Set `DB_ENABLED=true` and configure the PXC writer/proxy endpoint in `.env.local`, then start the stack. Set `DB_AUTO_CREATE=true` when the configured user is allowed to create databases; the backend will create `DB_NAME` with `utf8mb4` before applying the schema from `backend/src/db/schema.sql`. For production, create the database during provisioning and leave `DB_AUTO_CREATE=false`. Run `POST http://localhost:5001/api/v1/sync` after startup to fetch Jira data and persist a transactional snapshot. With persistence enabled, dashboard metrics read from Percona instead of querying Jira issues on every request. Redis remains the cache layer.

For PXC, point `DB_HOST` at the organization-approved HAProxy/ProxySQL writer endpoint rather than an arbitrary cluster node. The database user needs `CREATE`, `ALTER`, `SELECT`, and `INSERT`/`UPDATE` permissions on `DB_NAME` for first-time schema setup; after provisioning, remove `CREATE`/`ALTER` from the runtime user if required by policy. Verify `GET /api/v1/health` reports `database.connected: true`, then run:

```bash
curl -X POST http://localhost:5001/api/v1/sync
curl http://localhost:3000/api/jira
```

## Security Notes

- Credentials are read only from server-side environment variables.
- No Jira token is exposed to the client bundle.
- API input and response payloads are validated with Zod.
- Logs should be centralized and should never include raw secrets.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `JIRA_DOMAIN` | Yes | Jira cloud URL, for example https://example.atlassian.net |
| `JIRA_EMAIL` | Yes for API token auth | Atlassian email |
| `JIRA_API_TOKEN` | Yes for API token auth | Jira API token |
| `JIRA_OAUTH_TOKEN` | Optional | Bearer token for OAuth 2.0 |
| `JIRA_PROJECT_KEY` | Optional | Default project filter |
| `JIRA_CACHE_TTL_MS` | Optional | Cache lifetime in milliseconds |
| `NEXT_PUBLIC_SITE_URL` | Optional | Public app URL |

## Deployment Notes

This dashboard is intended for enterprise operational analytics and should be adapted to your internal security, deployment, and access-control policies before production use.

## Podman runtime notes

- Docker is intentionally not used here; the project is set up for Podman via the [podman-compose.yml](podman-compose.yml) file.
- If your environment blocks npm registry access, the app cannot be installed from this workstation until that external restriction is removed.
- The generated code itself was rechecked against Jira’s real response contract and corrected for the actual API payload shapes.

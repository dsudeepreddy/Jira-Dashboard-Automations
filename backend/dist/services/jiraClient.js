"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jiraDiagnostics = exports.jiraClient = exports.JiraClient = exports.JiraClientError = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
const redisClient_1 = require("../cache/redisClient");
const analytics_1 = require("../shared/analytics");
class JiraClientError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.name = 'JiraClientError';
    }
}
exports.JiraClientError = JiraClientError;
function parseSprints(raw) {
    if (!raw)
        return [];
    if (Array.isArray(raw))
        return raw.flatMap((item) => parseSprints(item));
    if (typeof raw === 'object' && raw && 'id' in raw) {
        const sprint = raw;
        const id = Number(sprint.id);
        if (!Number.isFinite(id))
            return [];
        return [{
                id,
                name: String(sprint.name || `Sprint ${id}`),
                state: String(sprint.state || 'unknown').toLowerCase(),
                startDate: sprint.startDate ? String(sprint.startDate) : undefined,
                endDate: sprint.endDate ? String(sprint.endDate) : undefined,
                completeDate: sprint.completeDate ? String(sprint.completeDate) : undefined,
            }];
    }
    if (typeof raw === 'string') {
        const id = raw.match(/id=(\d+)/);
        if (!id)
            return [];
        const name = raw.match(/name=([^,\]]+)/);
        const state = raw.match(/state=([^,\]]+)/);
        const startDate = raw.match(/startDate=([^,\]]+)/);
        const endDate = raw.match(/endDate=([^,\]]+)/);
        const completeDate = raw.match(/completeDate=([^,\]]+)/);
        const asDate = (value) => value && value !== '<null>' ? value : undefined;
        return [{
                id: Number(id[1]),
                name: name?.[1] || `Sprint ${id[1]}`,
                state: (state?.[1] || 'unknown').toLowerCase(),
                startDate: asDate(startDate?.[1]),
                endDate: asDate(endDate?.[1]),
                completeDate: asDate(completeDate?.[1]),
            }];
    }
    return [];
}
function parseStoryPoints(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
        return Number(value);
    return null;
}
function parseFlagged(fields) {
    const flagged = fields.flagged;
    if (typeof flagged === 'string')
        return /impediment|flagged/i.test(flagged);
    if (flagged?.value)
        return /impediment|flagged/i.test(flagged.value);
    const labels = Array.isArray(fields.labels) ? fields.labels.map(String) : [];
    return labels.some((label) => /flagged|blocked/i.test(label));
}
function toJqlDate(value) {
    return value.replace('T', ' ').slice(0, 19);
}
class JiraClient {
    restBaseUrl;
    agileBaseUrl;
    statusLookup = new Map();
    constructor() {
        const domain = env_1.env.JIRA_DOMAIN.replace(/\/+$/, '');
        this.restBaseUrl = `${domain}/rest/api/3`;
        this.agileBaseUrl = `${domain}/rest/agile/1.0`;
    }
    setStatusLookup(statuses) {
        this.statusLookup = new Map(statuses.map((status) => [status.name.toLowerCase(), status.statusCategory?.key || '']));
    }
    async request(baseURL, path, options = {}) {
        const headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...options.headers,
        };
        if (env_1.env.JIRA_OAUTH_TOKEN) {
            headers.Authorization = `Bearer ${env_1.env.JIRA_OAUTH_TOKEN}`;
        }
        else if (env_1.env.JIRA_API_TOKEN && env_1.env.JIRA_EMAIL) {
            headers.Authorization = `Basic ${Buffer.from(`${env_1.env.JIRA_EMAIL}:${env_1.env.JIRA_API_TOKEN}`).toString('base64')}`;
        }
        else {
            throw new JiraClientError(401, 'JIRA_AUTH_ERROR', 'Missing Jira authentication configuration.');
        }
        try {
            const response = await (0, axios_1.default)({
                ...options,
                baseURL,
                url: path,
                headers,
                timeout: 30000,
                validateStatus: (status) => status >= 200 && status < 500,
            });
            if (response.status >= 400) {
                const errorBody = response.data;
                const detail = [
                    ...(errorBody?.errorMessages || []),
                    ...Object.values(errorBody?.errors || {}),
                ].filter(Boolean).join('; ');
                throw new JiraClientError(response.status, 'JIRA_API_ERROR', `Jira request failed for ${path}${detail ? `: ${detail}` : ''}`, { data: response.data, retryAfter: response.headers['retry-after'] });
            }
            return response.data;
        }
        catch (error) {
            if (error instanceof JiraClientError)
                throw error;
            const axiosError = error;
            throw new JiraClientError(axiosError.response?.status ?? 500, 'JIRA_REQUEST_ERROR', axiosError.message || 'Jira request failed', axiosError.response?.data);
        }
    }
    async withRetry(task) {
        let attempt = 0;
        while (attempt <= 3) {
            try {
                return await task();
            }
            catch (error) {
                const jiraError = error;
                const retryable = jiraError.statusCode === 429 || jiraError.statusCode >= 500;
                if (!retryable || attempt === 3)
                    throw error;
                const retryAfter = Number(jiraError.details?.retryAfter);
                const ms = Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(10000, 500 * 2 ** attempt);
                await new Promise((resolve) => setTimeout(resolve, ms));
                attempt += 1;
            }
        }
        throw new Error('Jira retry loop exhausted');
    }
    async getProjects() {
        const cacheKey = 'jira:projects';
        const cached = await redisClient_1.redisCache.get(cacheKey);
        if (cached)
            return cached;
        const response = await this.withRetry(() => this.request(this.restBaseUrl, '/project/search', {
            params: { maxResults: 200 },
        }));
        const projects = response.values ?? [];
        await redisClient_1.redisCache.set(cacheKey, projects);
        return projects;
    }
    async getBoards() {
        const response = await this.withRetry(() => this.request(this.agileBaseUrl, '/board', { params: { maxResults: 50 } }));
        return response.values ?? [];
    }
    async getSprints() {
        const cacheKey = 'jira:sprints';
        const cached = await redisClient_1.redisCache.get(cacheKey);
        if (cached)
            return cached;
        const boardIds = env_1.env.JIRA_BOARD_ID ? [env_1.env.JIRA_BOARD_ID] : (await this.getBoards()).map((board) => board.id).slice(0, 8);
        const sprints = [];
        for (const boardId of boardIds) {
            const response = await this.withRetry(() => this.request(this.agileBaseUrl, `/board/${boardId}/sprint`, { params: { maxResults: 200, state: 'active,closed,future' } }));
            for (const sprint of response.values ?? []) {
                sprints.push({ ...sprint, boardId });
            }
        }
        await redisClient_1.redisCache.set(cacheKey, sprints);
        return sprints;
    }
    async getIssueTypes() {
        const cacheKey = 'jira:issueTypes';
        const cached = await redisClient_1.redisCache.get(cacheKey);
        if (cached)
            return cached;
        const response = await this.withRetry(() => this.request(this.restBaseUrl, '/issuetype'));
        const issueTypes = Array.isArray(response) ? response : [];
        await redisClient_1.redisCache.set(cacheKey, issueTypes);
        return issueTypes;
    }
    async getIssueStatuses() {
        const cacheKey = 'jira:statuses';
        const cached = await redisClient_1.redisCache.get(cacheKey);
        if (cached)
            return cached;
        const response = await this.withRetry(() => this.request(this.restBaseUrl, '/status'));
        const statuses = Array.isArray(response) ? response : [];
        this.setStatusLookup(statuses);
        await redisClient_1.redisCache.set(cacheKey, statuses);
        return statuses;
    }
    async searchIssues(filters = {}) {
        if (!this.statusLookup.size) {
            try {
                await this.getIssueStatuses();
            }
            catch { /* cycle-time fallback still works */ }
        }
        const parts = [];
        const projectKey = filters.projectKey || env_1.env.JIRA_PROJECT_KEY;
        if (projectKey)
            parts.push(`project = "${projectKey.replace(/"/g, '\\"')}"`);
        if (filters.sprintId)
            parts.push(`sprint = ${filters.sprintId}`);
        if (filters.issueType)
            parts.push(`issuetype = "${filters.issueType.replace(/"/g, '\\"')}"`);
        if (filters.startDate && filters.endDate) {
            parts.push(`created >= "${filters.startDate}" AND created <= "${filters.endDate}"`);
        }
        if (filters.updatedSince) {
            parts.push(`updated >= "${toJqlDate(filters.updatedSince)}"`);
        }
        else if (!filters.unbounded && !filters.startDate && !filters.endDate) {
            parts.push(`updated >= -${filters.lookbackDays || env_1.env.JIRA_LOOKBACK_DAYS}d`);
        }
        const jql = `${parts.join(' AND ')} ORDER BY updated ASC`;
        const issues = [];
        const discoveredSprints = new Map();
        let nextPageToken;
        const pageSize = Math.min(env_1.env.JIRA_PAGE_SIZE, 100);
        while (issues.length < env_1.env.JIRA_MAX_ISSUES) {
            const page = await this.withRetry(() => this.request(this.restBaseUrl, '/search/jql', {
                method: 'POST',
                data: {
                    jql,
                    maxResults: Math.min(pageSize, env_1.env.JIRA_MAX_ISSUES - issues.length),
                    nextPageToken,
                    expand: 'changelog',
                    fields: [
                        'summary', 'status', 'issuetype', 'created', 'updated', 'resolutiondate',
                        'project', 'priority', 'assignee', 'labels', 'flagged',
                        env_1.env.JIRA_STORY_POINTS_FIELD, env_1.env.JIRA_SPRINT_FIELD, 'sprint', 'closedSprints',
                    ],
                },
            }));
            const pageIssues = page.issues ?? [];
            for (const raw of pageIssues) {
                const mapped = this.mapIssue(raw);
                issues.push(mapped.issue);
                mapped.sprints.forEach((sprint) => discoveredSprints.set(sprint.id, sprint));
            }
            if (page.isLast || !page.nextPageToken || pageIssues.length === 0)
                break;
            nextPageToken = page.nextPageToken;
        }
        return {
            issues: issues.slice(0, env_1.env.JIRA_MAX_ISSUES),
            sprints: [...discoveredSprints.values()],
        };
    }
    mapIssue(raw) {
        const issue = raw;
        const fields = issue.fields || {};
        const statusName = typeof fields.status === 'string'
            ? fields.status
            : String(fields.status?.name || 'Unknown');
        const hasSprintField = fields[env_1.env.JIRA_SPRINT_FIELD] != null || fields.sprint != null;
        const sprints = [
            ...parseSprints(fields[env_1.env.JIRA_SPRINT_FIELD]),
            ...parseSprints(fields.sprint),
            ...parseSprints(fields.closedSprints),
        ];
        const uniqueSprints = [...new Map(sprints.map((sprint) => [sprint.id, sprint])).values()].filter((sprint) => Number.isFinite(sprint.id));
        const resolved = fields.resolutiondate || null;
        const created = String(fields.created || '');
        const flow = (0, analytics_1.deriveFlowTimestamps)(created, resolved, issue.changelog?.histories || [], this.statusLookup);
        const assignee = fields.assignee;
        return {
            sprints: uniqueSprints,
            issue: {
                id: String(issue.id),
                key: String(issue.key),
                summary: String(fields.summary || ''),
                status: statusName,
                statusCategory: (0, analytics_1.categoryForStatus)(statusName, this.statusLookup),
                issueType: fields.issuetype?.name,
                projectKey: fields.project?.key,
                created,
                updated: String(fields.updated || created),
                resolved,
                assignee: assignee?.displayName || null,
                storyPoints: parseStoryPoints(fields[env_1.env.JIRA_STORY_POINTS_FIELD]),
                flagged: parseFlagged(fields) || /block/i.test(statusName),
                inProgressAt: flow.inProgressAt,
                lastStatusChangedAt: flow.lastStatusChangedAt,
                sprintIds: uniqueSprints.length || hasSprintField || fields.closedSprints != null
                    ? uniqueSprints.map((sprint) => sprint.id)
                    : undefined,
            },
        };
    }
}
exports.JiraClient = JiraClient;
exports.jiraClient = new JiraClient();
exports.jiraDiagnostics = {
    domain: env_1.env.JIRA_DOMAIN,
    email: env_1.env.JIRA_EMAIL ? (0, env_1.maskSecret)(env_1.env.JIRA_EMAIL) : 'not-configured',
    apiToken: env_1.env.JIRA_API_TOKEN ? (0, env_1.maskSecret)(env_1.env.JIRA_API_TOKEN) : 'not-configured',
    oauthToken: env_1.env.JIRA_OAUTH_TOKEN ? (0, env_1.maskSecret)(env_1.env.JIRA_OAUTH_TOKEN) : 'not-configured',
    projectKey: env_1.env.JIRA_PROJECT_KEY || 'not-configured',
};

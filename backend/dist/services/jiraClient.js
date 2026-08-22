"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jiraDiagnostics = exports.jiraClient = exports.JiraClient = exports.JiraClientError = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
const redisClient_1 = require("../cache/redisClient");
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
class JiraClient {
    baseUrl;
    constructor() {
        this.baseUrl = `${env_1.env.JIRA_DOMAIN.replace(/\/+$/, '')}/rest/api/3`;
    }
    async request(path, options = {}) {
        const headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...options.headers,
        };
        const hasToken = Boolean(env_1.env.JIRA_API_TOKEN);
        const hasOAuth = Boolean(env_1.env.JIRA_OAUTH_TOKEN);
        if (hasOAuth) {
            headers.Authorization = `Bearer ${env_1.env.JIRA_OAUTH_TOKEN}`;
        }
        else if (hasToken && env_1.env.JIRA_EMAIL) {
            const token = Buffer.from(`${env_1.env.JIRA_EMAIL}:${env_1.env.JIRA_API_TOKEN}`).toString('base64');
            headers.Authorization = `Basic ${token}`;
        }
        else {
            throw new JiraClientError(401, 'JIRA_AUTH_ERROR', 'Missing Jira authentication configuration.');
        }
        try {
            const response = await (0, axios_1.default)({
                ...options,
                baseURL: this.baseUrl,
                url: path,
                headers,
                timeout: 20000,
                validateStatus: (status) => status >= 200 && status < 500,
            });
            if (response.status >= 400) {
                const errorBody = response.data;
                const detail = [
                    ...(errorBody?.errorMessages || []),
                    ...Object.values(errorBody?.errors || {}),
                ].filter(Boolean).join('; ');
                const retryAfter = response.headers['retry-after'];
                throw new JiraClientError(response.status, 'JIRA_API_ERROR', `Jira request failed for ${path}${detail ? `: ${detail}` : ''}`, { data: response.data, retryAfter });
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
                if (!retryable || attempt === 3) {
                    throw error;
                }
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
        const response = await this.withRetry(() => this.request('/project/search', {
            params: { maxResults: 200 },
        }));
        const projects = response.values ?? [];
        await redisClient_1.redisCache.set(cacheKey, projects);
        return projects;
    }
    async getSprints() {
        if (!env_1.env.JIRA_BOARD_ID)
            return [];
        const cacheKey = 'jira:sprints';
        const cached = await redisClient_1.redisCache.get(cacheKey);
        if (cached)
            return cached;
        const agileBaseUrl = `${env_1.env.JIRA_DOMAIN.replace(/\/+$/, '')}/rest/agile/1.0`;
        const response = await this.withRetry(() => this.request(`${agileBaseUrl}/board/${env_1.env.JIRA_BOARD_ID}/sprint`, { params: { maxResults: 200 } }));
        const sprints = response.values ?? [];
        await redisClient_1.redisCache.set(cacheKey, sprints);
        return sprints;
    }
    async getIssueTypes() {
        const cacheKey = 'jira:issueTypes';
        const cached = await redisClient_1.redisCache.get(cacheKey);
        if (cached)
            return cached;
        const response = await this.withRetry(() => this.request('/issuetype'));
        const issueTypes = Array.isArray(response) ? response : [];
        await redisClient_1.redisCache.set(cacheKey, issueTypes);
        return issueTypes;
    }
    async getIssueStatuses() {
        const cacheKey = 'jira:statuses';
        const cached = await redisClient_1.redisCache.get(cacheKey);
        if (cached)
            return cached;
        const response = await this.withRetry(() => this.request('/status'));
        const statuses = Array.isArray(response) ? response : [];
        await redisClient_1.redisCache.set(cacheKey, statuses);
        return statuses;
    }
    async searchIssues(filters = {}) {
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
        const jql = parts.length ? `${parts.join(' AND ')} ORDER BY created DESC` : 'created >= -30d ORDER BY created DESC';
        const issues = [];
        let nextPageToken;
        while (issues.length < env_1.env.JIRA_MAX_ISSUES) {
            const page = await this.withRetry(() => this.request('/search/jql', {
                method: 'POST',
                data: {
                    jql,
                    maxResults: Math.min(env_1.env.JIRA_PAGE_SIZE, env_1.env.JIRA_MAX_ISSUES - issues.length),
                    nextPageToken,
                    fields: ['summary', 'status', 'issuetype', 'created', 'updated', 'resolutiondate', 'project', 'priority'],
                },
            }));
            const pageIssues = page.issues ?? [];
            issues.push(...pageIssues);
            if (page.isLast || !page.nextPageToken || pageIssues.length === 0)
                break;
            nextPageToken = page.nextPageToken;
        }
        return issues.slice(0, env_1.env.JIRA_MAX_ISSUES).map((issue) => {
            const fields = issue.fields || issue;
            return {
                id: issue.id,
                key: issue.key,
                summary: fields.summary || '',
                status: typeof fields.status === 'string' ? fields.status : fields.status?.name || 'Unknown',
                created: fields.created,
                updated: fields.updated,
                resolved: fields.resolved ?? fields.resolutiondate ?? null,
                issuetype: fields.issuetype ? { name: fields.issuetype.name } : undefined,
                project: fields.project ? { key: fields.project.key, name: fields.project.name } : undefined,
                priority: fields.priority ? { name: fields.priority.name } : undefined,
            };
        });
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

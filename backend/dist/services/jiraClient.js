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
const dashboardContract_1 = require("../shared/dashboardContract");
const comments_1 = require("../shared/comments");
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
function uniqueBy(items, keyOf) {
    const seen = new Set();
    const unique = [];
    for (const item of items) {
        const key = keyOf(item);
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        unique.push(item);
    }
    return unique;
}
function parseNamed(value) {
    if (typeof value === 'string' && value.trim())
        return value.trim();
    if (value && typeof value === 'object') {
        const record = value;
        for (const key of ['value', 'name', 'displayName']) {
            const part = record[key];
            if (typeof part === 'string' && part.trim())
                return part.trim();
        }
    }
    return null;
}
function parseNameList(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.map(parseNamed).filter((name) => Boolean(name)))];
}
function parseSelectValues(value) {
    if (value == null || value === '')
        return [];
    if (Array.isArray(value))
        return parseNameList(value);
    const single = parseNamed(value);
    return single ? [single] : [];
}
function jqlCustomField(fieldId, value) {
    const escaped = value.replace(/"/g, '\\"');
    const numeric = fieldId.startsWith('customfield_') ? fieldId.slice('customfield_'.length) : '';
    const clause = /^\d+$/.test(numeric) ? `cf[${numeric}]` : `"${fieldId.replace(/"/g, '\\"')}"`;
    return `${clause} = "${escaped}"`;
}
function normalizeFieldName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function parseEpic(fields, epicLinkId) {
    const parent = fields.parent;
    if (parent?.key) {
        return { epicKey: parent.key, epicName: parent.fields?.summary || parent.key };
    }
    if (epicLinkId && fields[epicLinkId] != null) {
        const raw = fields[epicLinkId];
        if (typeof raw === 'string' && raw.trim())
            return { epicKey: raw.trim(), epicName: raw.trim() };
        const named = raw;
        if (named?.key)
            return { epicKey: named.key, epicName: named.summary || named.name || named.key };
    }
    const links = Array.isArray(fields.issuelinks) ? fields.issuelinks : [];
    for (const link of links) {
        const item = link;
        const typeName = `${item.type?.name || ''} ${item.type?.inward || ''} ${item.type?.outward || ''}`.toLowerCase();
        const candidates = [item.inwardIssue, item.outwardIssue].filter(Boolean);
        for (const candidate of candidates) {
            const isEpic = candidate?.fields?.issuetype?.name?.toLowerCase() === 'epic' || /\bepic\b/.test(typeName);
            if (isEpic && candidate?.key) {
                return { epicKey: candidate.key, epicName: candidate.fields?.summary || candidate.key };
            }
        }
    }
    return { epicKey: null, epicName: null };
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
    projectsCatalogLoad = null;
    auditFields = {};
    auditFieldsResolved = false;
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
    async paginateValues(baseURL, path, extraParams = {}, pageSize = 50) {
        const all = [];
        let startAt = 0;
        for (let page = 0; page < 200; page += 1) {
            const response = await this.withRetry(() => this.request(baseURL, path, {
                params: { ...extraParams, startAt, maxResults: pageSize },
            }));
            const values = response.values ?? [];
            all.push(...values);
            const done = Boolean(response.isLast)
                || values.length === 0
                || values.length < pageSize
                || (typeof response.total === 'number' && all.length >= response.total);
            if (done)
                break;
            startAt += values.length;
        }
        return all;
    }
    async getProjects() {
        const catalog = await this.loadProjectsCatalog();
        return catalog.projects;
    }
    async loadProjectsCatalog() {
        if (this.projectsCatalogLoad)
            return this.projectsCatalogLoad;
        this.projectsCatalogLoad = this.fetchProjectsCatalog().finally(() => {
            this.projectsCatalogLoad = null;
        });
        return this.projectsCatalogLoad;
    }
    async fetchProjectsCatalog() {
        const cacheKey = 'jira:projects:all';
        const cachedProjects = await redisClient_1.redisCache.get(cacheKey);
        const cachedTypes = await redisClient_1.redisCache.get('jira:issueTypes:fromProjects');
        if (cachedProjects?.length) {
            return { projects: cachedProjects, issueTypes: cachedTypes || [] };
        }
        let rows = [];
        try {
            rows = await this.paginateValues(this.restBaseUrl, '/project/search', { orderBy: 'name', expand: 'issueTypes' }, 50);
        }
        catch {
            rows = await this.paginateValues(this.restBaseUrl, '/project/search', { orderBy: 'name' }, 50);
        }
        const projects = uniqueBy(rows.map((project) => ({
            id: String(project.id),
            key: project.key,
            name: project.name,
            projectTypeKey: project.projectTypeKey,
        })), (project) => project.key).sort((a, b) => a.name.localeCompare(b.name));
        const issueTypes = uniqueBy(rows.flatMap((project) => project.issueTypes || []), (type) => String(type.id));
        await redisClient_1.redisCache.set(cacheKey, projects);
        await redisClient_1.redisCache.set('jira:issueTypes:fromProjects', issueTypes);
        return { projects, issueTypes };
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
        const cacheKey = 'jira:issueTypes:all';
        const cached = await redisClient_1.redisCache.get(cacheKey);
        if (cached?.length)
            return cached;
        let fromApi = [];
        try {
            fromApi = await this.paginateValues(this.restBaseUrl, '/issuetype/search', {}, 50);
        }
        catch {
            const response = await this.withRetry(() => this.request(this.restBaseUrl, '/issuetype'));
            fromApi = Array.isArray(response) ? response : response.values ?? [];
        }
        const fromProjects = (await this.loadProjectsCatalog()).issueTypes;
        const issueTypes = uniqueBy([...fromApi, ...fromProjects].map((type) => ({
            id: String(type.id),
            name: type.name,
            description: type.description,
        })), (type) => type.name.trim().toLowerCase()).sort((a, b) => a.name.localeCompare(b.name));
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
    async resolveAuditFields() {
        if (this.auditFieldsResolved)
            return this.auditFields;
        const cacheKey = 'jira:audit-fields';
        const cached = await redisClient_1.redisCache.get(cacheKey);
        if (cached) {
            this.auditFields = cached;
            this.auditFieldsResolved = true;
            return cached;
        }
        const resolved = {
            licenseBu: env_1.env.JIRA_LICENSE_BU_FIELD || undefined,
            auditType: env_1.env.JIRA_AUDIT_TYPE_FIELD || undefined,
            application: env_1.env.JIRA_APPLICATION_FIELD || undefined,
            epicLink: env_1.env.JIRA_EPIC_LINK_FIELD || undefined,
        };
        try {
            const fields = await this.withRetry(() => this.request(this.restBaseUrl, '/field'));
            const list = Array.isArray(fields) ? fields : [];
            const pick = (predicate) => {
                const match = list.find((field) => {
                    const name = String(field.name || '');
                    return predicate(normalizeFieldName(name), name);
                });
                return match?.id || match?.key;
            };
            resolved.licenseBu ||= pick((normalized, name) => normalized === 'licensebu' || /license\s*\/\s*bu/i.test(name) || normalized === 'businessunit');
            resolved.auditType ||= pick((normalized) => normalized === 'audittype');
            resolved.application ||= pick((normalized, name) => normalized === 'application' || name.trim().toLowerCase() === 'application');
            resolved.epicLink ||= pick((normalized, name) => normalized === 'epiclink' || name.trim().toLowerCase() === 'epic link');
        }
        catch {
            /* field names still work in JQL if IDs are unknown */
        }
        this.auditFields = resolved;
        this.auditFieldsResolved = true;
        await redisClient_1.redisCache.set(cacheKey, resolved);
        return resolved;
    }
    async getEpics(projectKey) {
        const key = projectKey || env_1.env.JIRA_PROJECT_KEY;
        const cacheKey = `jira:epics:${key || 'all'}`;
        const cached = await redisClient_1.redisCache.get(cacheKey);
        if (cached)
            return cached;
        const parts = ['issuetype = Epic'];
        if (key)
            parts.push(`project = "${key.replace(/"/g, '\\"')}"`);
        const epics = [];
        let nextPageToken;
        try {
            do {
                const page = await this.withRetry(() => this.request(this.restBaseUrl, '/search/jql', {
                    method: 'POST',
                    data: {
                        jql: `${parts.join(' AND ')} ORDER BY created DESC`,
                        maxResults: 50,
                        nextPageToken,
                        fields: ['summary'],
                    },
                }));
                for (const issue of page.issues || []) {
                    if (!issue.key)
                        continue;
                    epics.push({ key: issue.key, name: String(issue.fields?.summary || issue.key) });
                }
                if (page.isLast || !page.nextPageToken || !(page.issues || []).length)
                    break;
                nextPageToken = page.nextPageToken;
            } while (epics.length < 100);
        }
        catch {
            return epics;
        }
        const unique = [...new Map(epics.map((epic) => [epic.key, epic])).values()];
        await redisClient_1.redisCache.set(cacheKey, unique);
        return unique;
    }
    async searchIssues(filters = {}) {
        if (!this.statusLookup.size) {
            try {
                await this.getIssueStatuses();
            }
            catch { /* cycle-time fallback still works */ }
        }
        const auditFields = await this.resolveAuditFields().catch(() => this.auditFields);
        const parts = [];
        const projectKey = filters.projectKey || env_1.env.JIRA_PROJECT_KEY;
        if (projectKey)
            parts.push(`project = "${projectKey.replace(/"/g, '\\"')}"`);
        if (filters.sprintId)
            parts.push(`sprint = ${filters.sprintId}`);
        if (filters.issueType)
            parts.push(`issuetype = "${filters.issueType.replace(/"/g, '\\"')}"`);
        if (filters.label === dashboardContract_1.UNTAGGED_LABEL)
            parts.push('labels is EMPTY');
        else if (filters.label)
            parts.push(`labels = "${filters.label.replace(/"/g, '\\"')}"`);
        if (filters.epicKey) {
            const epic = filters.epicKey.replace(/"/g, '\\"');
            const epicClauses = [`parent = "${epic}"`, `parentEpic = "${epic}"`];
            if (auditFields.epicLink)
                epicClauses.push(jqlCustomField(auditFields.epicLink, filters.epicKey));
            else
                epicClauses.push(`"Epic Link" = "${epic}"`);
            parts.push(`(${epicClauses.join(' OR ')})`);
        }
        if (filters.licenseBu && auditFields.licenseBu)
            parts.push(jqlCustomField(auditFields.licenseBu, filters.licenseBu));
        else if (filters.licenseBu)
            parts.push(`"License/BU" = "${filters.licenseBu.replace(/"/g, '\\"')}"`);
        if (filters.auditType && auditFields.auditType)
            parts.push(jqlCustomField(auditFields.auditType, filters.auditType));
        else if (filters.auditType)
            parts.push(`"Audit Type" = "${filters.auditType.replace(/"/g, '\\"')}"`);
        if (filters.application && auditFields.application)
            parts.push(jqlCustomField(auditFields.application, filters.application));
        else if (filters.application)
            parts.push(`"Application" = "${filters.application.replace(/"/g, '\\"')}"`);
        const createdRange = (0, analytics_1.createdDateJql)(filters.startDate, filters.endDate);
        if (createdRange)
            parts.push(`(${createdRange})`);
        if (filters.updatedSince) {
            parts.push(`updated >= "${toJqlDate(filters.updatedSince)}"`);
        }
        else if (!filters.unbounded && !filters.epicKey && !filters.startDate && !filters.endDate) {
            parts.push(`updated >= -${filters.lookbackDays || env_1.env.JIRA_LOOKBACK_DAYS}d`);
        }
        const allowedOrder = new Set(['updated ASC', 'updated DESC', 'created ASC', 'created DESC', 'key ASC', 'key DESC']);
        const orderBy = filters.orderBy && allowedOrder.has(filters.orderBy) ? filters.orderBy : 'updated ASC';
        const jql = `${parts.join(' AND ')} ORDER BY ${orderBy}`;
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
                        'project', 'priority', 'assignee', 'labels', 'flagged', 'components',
                        'parent', 'issuelinks',
                        env_1.env.JIRA_STORY_POINTS_FIELD, env_1.env.JIRA_SPRINT_FIELD, 'sprint', 'closedSprints',
                        ...[auditFields.licenseBu, auditFields.auditType, auditFields.application, auditFields.epicLink].filter(Boolean),
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
        const epic = parseEpic(fields, this.auditFields.epicLink);
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
                priority: parseNamed(fields.priority),
                labels: parseNameList(fields.labels),
                components: parseNameList(fields.components),
                licenseBu: parseSelectValues(this.auditFields.licenseBu ? fields[this.auditFields.licenseBu] : fields['License/BU']),
                auditType: parseSelectValues(this.auditFields.auditType ? fields[this.auditFields.auditType] : undefined),
                application: parseSelectValues(this.auditFields.application ? fields[this.auditFields.application] : undefined),
                epicKey: epic.epicKey,
                epicName: epic.epicName,
                inProgressAt: flow.inProgressAt,
                lastStatusChangedAt: flow.lastStatusChangedAt,
                validationDays: (0, analytics_1.calculateValidationTime)(created, resolved, statusName, issue.changelog?.histories || []),
                sprintIds: uniqueSprints.length || hasSprintField || fields.closedSprints != null
                    ? uniqueSprints.map((sprint) => sprint.id)
                    : undefined,
            },
        };
    }
    async getLatestHumanComments(issueKeys) {
        const result = new Map();
        const keys = [...new Set(issueKeys.filter(Boolean))];
        if (!keys.length)
            return result;
        const loadComments = async (key) => {
            const first = await this.withRetry(() => this.request(this.restBaseUrl, `/issue/${encodeURIComponent(key)}/comment`, { method: 'GET', params: { maxResults: 50, startAt: 0 } }));
            const total = first.total ?? (first.comments || []).length;
            if (total <= (first.comments || []).length)
                return first.comments || [];
            const last = await this.withRetry(() => this.request(this.restBaseUrl, `/issue/${encodeURIComponent(key)}/comment`, { method: 'GET', params: { maxResults: 50, startAt: Math.max(0, total - 50) } }));
            return last.comments || first.comments || [];
        };
        for (let index = 0; index < keys.length; index += 8) {
            const chunk = keys.slice(index, index + 8);
            await Promise.all(chunk.map(async (key) => {
                try {
                    const latest = (0, comments_1.latestHumanComment)(await loadComments(key));
                    if (latest)
                        result.set(key, latest);
                }
                catch {
                    /* leave issue without a comment */
                }
            }));
        }
        return result;
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

import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { env, maskSecret } from '../config/env';
import { redisCache } from '../cache/redisClient';
import {
  categoryForStatus,
  createdDateJql,
  deriveFlowTimestamps,
  type AnalyticsIssue,
  type AnalyticsSprint,
  type ChangelogHistory,
} from '../shared/analytics';

export interface JiraProject { id: string; key: string; name: string; projectTypeKey?: string; }
export interface JiraSprint extends AnalyticsSprint { boardId?: number; }
export interface JiraIssueType { id: string; name: string; description?: string; }
export interface JiraIssueStatus {
  id: string;
  name: string;
  statusCategory?: { key?: string; name?: string };
}

export type JiraIssue = AnalyticsIssue;

export class JiraClientError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'JiraClientError';
  }
}

type SearchFilters = {
  projectKey?: string;
  sprintId?: number;
  issueType?: string;
  startDate?: string;
  endDate?: string;
  updatedSince?: string;
  lookbackDays?: number;
  unbounded?: boolean;
  orderBy?: string;
};

function parseSprints(raw: unknown): AnalyticsSprint[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.flatMap((item) => parseSprints(item));
  if (typeof raw === 'object' && raw && 'id' in raw) {
    const sprint = raw as Record<string, unknown>;
    const id = Number(sprint.id);
    if (!Number.isFinite(id)) return [];
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
    if (!id) return [];
    const name = raw.match(/name=([^,\]]+)/);
    const state = raw.match(/state=([^,\]]+)/);
    const startDate = raw.match(/startDate=([^,\]]+)/);
    const endDate = raw.match(/endDate=([^,\]]+)/);
    const completeDate = raw.match(/completeDate=([^,\]]+)/);
    const asDate = (value?: string | null) => value && value !== '<null>' ? value : undefined;
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

type JiraPage<T> = {
  values?: T[];
  isLast?: boolean;
  total?: number;
};

function uniqueBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function parseStoryPoints(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function parseFlagged(fields: Record<string, unknown>): boolean {
  const flagged = fields.flagged as { value?: string } | string | undefined;
  if (typeof flagged === 'string') return /impediment|flagged/i.test(flagged);
  if (flagged?.value) return /impediment|flagged/i.test(flagged.value);
  const labels = Array.isArray(fields.labels) ? fields.labels.map(String) : [];
  return labels.some((label) => /flagged|blocked/i.test(label));
}

function toJqlDate(value: string) {
  return value.replace('T', ' ').slice(0, 19);
}

export class JiraClient {
  private readonly restBaseUrl: string;
  private readonly agileBaseUrl: string;
  private statusLookup = new Map<string, string>();
  private projectsCatalogLoad: Promise<{ projects: JiraProject[]; issueTypes: JiraIssueType[] }> | null = null;

  constructor() {
    const domain = env.JIRA_DOMAIN.replace(/\/+$/, '');
    this.restBaseUrl = `${domain}/rest/api/3`;
    this.agileBaseUrl = `${domain}/rest/agile/1.0`;
  }

  setStatusLookup(statuses: JiraIssueStatus[]) {
    this.statusLookup = new Map(
      statuses.map((status) => [status.name.toLowerCase(), status.statusCategory?.key || '']),
    );
  }

  private async request<T>(baseURL: string, path: string, options: AxiosRequestConfig = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };

    if (env.JIRA_OAUTH_TOKEN) {
      headers.Authorization = `Bearer ${env.JIRA_OAUTH_TOKEN}`;
    } else if (env.JIRA_API_TOKEN && env.JIRA_EMAIL) {
      headers.Authorization = `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')}`;
    } else {
      throw new JiraClientError(401, 'JIRA_AUTH_ERROR', 'Missing Jira authentication configuration.');
    }

    try {
      const response = await axios({
        ...options,
        baseURL,
        url: path,
        headers,
        timeout: 30000,
        validateStatus: (status) => status >= 200 && status < 500,
      });

      if (response.status >= 400) {
        const errorBody = response.data as { errorMessages?: string[]; errors?: Record<string, string> } | undefined;
        const detail = [
          ...(errorBody?.errorMessages || []),
          ...Object.values(errorBody?.errors || {}),
        ].filter(Boolean).join('; ');
        throw new JiraClientError(
          response.status,
          'JIRA_API_ERROR',
          `Jira request failed for ${path}${detail ? `: ${detail}` : ''}`,
          { data: response.data, retryAfter: response.headers['retry-after'] },
        );
      }

      return response.data as T;
    } catch (error) {
      if (error instanceof JiraClientError) throw error;
      const axiosError = error as AxiosError;
      throw new JiraClientError(
        axiosError.response?.status ?? 500,
        'JIRA_REQUEST_ERROR',
        axiosError.message || 'Jira request failed',
        axiosError.response?.data,
      );
    }
  }

  private async withRetry<T>(task: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (attempt <= 3) {
      try {
        return await task();
      } catch (error) {
        const jiraError = error as JiraClientError;
        const retryable = jiraError.statusCode === 429 || jiraError.statusCode >= 500;
        if (!retryable || attempt === 3) throw error;
        const retryAfter = Number((jiraError.details as { retryAfter?: string } | undefined)?.retryAfter);
        const ms = Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(10000, 500 * 2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, ms));
        attempt += 1;
      }
    }
    throw new Error('Jira retry loop exhausted');
  }

  private async paginateValues<T>(baseURL: string, path: string, extraParams: Record<string, string | number> = {}, pageSize = 50): Promise<T[]> {
    const all: T[] = [];
    let startAt = 0;
    for (let page = 0; page < 200; page += 1) {
      const response = await this.withRetry(() => this.request<JiraPage<T>>(baseURL, path, {
        params: { ...extraParams, startAt, maxResults: pageSize },
      }));
      const values = response.values ?? [];
      all.push(...values);
      const done = Boolean(response.isLast)
        || values.length === 0
        || values.length < pageSize
        || (typeof response.total === 'number' && all.length >= response.total);
      if (done) break;
      startAt += values.length;
    }
    return all;
  }

  async getProjects(): Promise<JiraProject[]> {
    const catalog = await this.loadProjectsCatalog();
    return catalog.projects;
  }

  private async loadProjectsCatalog(): Promise<{ projects: JiraProject[]; issueTypes: JiraIssueType[] }> {
    if (this.projectsCatalogLoad) return this.projectsCatalogLoad;
    this.projectsCatalogLoad = this.fetchProjectsCatalog().finally(() => {
      this.projectsCatalogLoad = null;
    });
    return this.projectsCatalogLoad;
  }

  private async fetchProjectsCatalog(): Promise<{ projects: JiraProject[]; issueTypes: JiraIssueType[] }> {
    const cacheKey = 'jira:projects:all';
    const cachedProjects = await redisCache.get<JiraProject[]>(cacheKey);
    const cachedTypes = await redisCache.get<JiraIssueType[]>('jira:issueTypes:fromProjects');
    if (cachedProjects?.length) {
      return { projects: cachedProjects, issueTypes: cachedTypes || [] };
    }

    let rows: Array<JiraProject & { issueTypes?: JiraIssueType[] }> = [];
    try {
      rows = await this.paginateValues<JiraProject & { issueTypes?: JiraIssueType[] }>(
        this.restBaseUrl,
        '/project/search',
        { orderBy: 'name', expand: 'issueTypes' },
        50,
      );
    } catch {
      rows = await this.paginateValues<JiraProject & { issueTypes?: JiraIssueType[] }>(
        this.restBaseUrl,
        '/project/search',
        { orderBy: 'name' },
        50,
      );
    }
    const projects = uniqueBy(
      rows.map((project) => ({
        id: String(project.id),
        key: project.key,
        name: project.name,
        projectTypeKey: project.projectTypeKey,
      })),
      (project) => project.key,
    ).sort((a, b) => a.name.localeCompare(b.name));
    const issueTypes = uniqueBy(
      rows.flatMap((project) => project.issueTypes || []),
      (type) => String(type.id),
    );
    await redisCache.set(cacheKey, projects);
    await redisCache.set('jira:issueTypes:fromProjects', issueTypes);
    return { projects, issueTypes };
  }

  async getBoards(): Promise<Array<{ id: number; name: string }>> {
    const response = await this.withRetry(() => this.request<{ values: Array<{ id: number; name: string }> }>(
      this.agileBaseUrl,
      '/board',
      { params: { maxResults: 50 } },
    ));
    return response.values ?? [];
  }

  async getSprints(): Promise<JiraSprint[]> {
    const cacheKey = 'jira:sprints';
    const cached = await redisCache.get<JiraSprint[]>(cacheKey);
    if (cached) return cached;

    const boardIds = env.JIRA_BOARD_ID ? [env.JIRA_BOARD_ID] : (await this.getBoards()).map((board) => board.id).slice(0, 8);
    const sprints: JiraSprint[] = [];
    for (const boardId of boardIds) {
      const response = await this.withRetry(() => this.request<{ values: JiraSprint[] }>(
        this.agileBaseUrl,
        `/board/${boardId}/sprint`,
        { params: { maxResults: 200, state: 'active,closed,future' } },
      ));
      for (const sprint of response.values ?? []) {
        sprints.push({ ...sprint, boardId });
      }
    }
    await redisCache.set(cacheKey, sprints);
    return sprints;
  }

  async getIssueTypes(): Promise<JiraIssueType[]> {
    const cacheKey = 'jira:issueTypes:all';
    const cached = await redisCache.get<JiraIssueType[]>(cacheKey);
    if (cached?.length) return cached;

    let fromApi: JiraIssueType[] = [];
    try {
      fromApi = await this.paginateValues<JiraIssueType>(this.restBaseUrl, '/issuetype/search', {}, 50);
    } catch {
      const response = await this.withRetry(() => this.request<JiraIssueType[] | JiraPage<JiraIssueType>>(this.restBaseUrl, '/issuetype'));
      fromApi = Array.isArray(response) ? response : response.values ?? [];
    }

    const fromProjects = (await this.loadProjectsCatalog()).issueTypes;

    const issueTypes = uniqueBy(
      [...fromApi, ...fromProjects].map((type) => ({
        id: String(type.id),
        name: type.name,
        description: type.description,
      })),
      (type) => type.name.trim().toLowerCase(),
    ).sort((a, b) => a.name.localeCompare(b.name));

    await redisCache.set(cacheKey, issueTypes);
    return issueTypes;
  }

  async getIssueStatuses(): Promise<JiraIssueStatus[]> {
    const cacheKey = 'jira:statuses';
    const cached = await redisCache.get<JiraIssueStatus[]>(cacheKey);
    if (cached) return cached;
    const response = await this.withRetry(() => this.request<JiraIssueStatus[]>(this.restBaseUrl, '/status'));
    const statuses = Array.isArray(response) ? response : [];
    this.setStatusLookup(statuses);
    await redisCache.set(cacheKey, statuses);
    return statuses;
  }

  async searchIssues(filters: SearchFilters = {}): Promise<{ issues: JiraIssue[]; sprints: AnalyticsSprint[] }> {
    if (!this.statusLookup.size) {
      try { await this.getIssueStatuses(); } catch { /* cycle-time fallback still works */ }
    }

    const parts: string[] = [];
    const projectKey = filters.projectKey || env.JIRA_PROJECT_KEY;
    if (projectKey) parts.push(`project = "${projectKey.replace(/"/g, '\\"')}"`);
    if (filters.sprintId) parts.push(`sprint = ${filters.sprintId}`);
    if (filters.issueType) parts.push(`issuetype = "${filters.issueType.replace(/"/g, '\\"')}"`);
    const createdRange = createdDateJql(filters.startDate, filters.endDate);
    if (createdRange) parts.push(`(${createdRange})`);
    if (filters.updatedSince) {
      parts.push(`updated >= "${toJqlDate(filters.updatedSince)}"`);
    } else if (!filters.unbounded && !filters.startDate && !filters.endDate) {
      parts.push(`updated >= -${filters.lookbackDays || env.JIRA_LOOKBACK_DAYS}d`);
    }

    const allowedOrder = new Set(['updated ASC', 'updated DESC', 'created ASC', 'created DESC', 'key ASC', 'key DESC']);
    const orderBy = filters.orderBy && allowedOrder.has(filters.orderBy) ? filters.orderBy : 'updated ASC';
    const jql = `${parts.join(' AND ')} ORDER BY ${orderBy}`;
    const issues: JiraIssue[] = [];
    const discoveredSprints = new Map<number, AnalyticsSprint>();
    let nextPageToken: string | undefined;
    const pageSize = Math.min(env.JIRA_PAGE_SIZE, 100);

    while (issues.length < env.JIRA_MAX_ISSUES) {
      const page = await this.withRetry(() => this.request<{ issues: unknown[]; isLast?: boolean; nextPageToken?: string }>(
        this.restBaseUrl,
        '/search/jql',
        {
          method: 'POST',
          data: {
            jql,
            maxResults: Math.min(pageSize, env.JIRA_MAX_ISSUES - issues.length),
            nextPageToken,
            expand: 'changelog',
            fields: [
              'summary', 'status', 'issuetype', 'created', 'updated', 'resolutiondate',
              'project', 'priority', 'assignee', 'labels', 'flagged',
              env.JIRA_STORY_POINTS_FIELD, env.JIRA_SPRINT_FIELD, 'sprint', 'closedSprints',
            ],
          },
        },
      ));

      const pageIssues = page.issues ?? [];
      for (const raw of pageIssues) {
        const mapped = this.mapIssue(raw);
        issues.push(mapped.issue);
        mapped.sprints.forEach((sprint) => discoveredSprints.set(sprint.id, sprint));
      }
      if (page.isLast || !page.nextPageToken || pageIssues.length === 0) break;
      nextPageToken = page.nextPageToken;
    }

    return {
      issues: issues.slice(0, env.JIRA_MAX_ISSUES),
      sprints: [...discoveredSprints.values()],
    };
  }

  private mapIssue(raw: unknown): { issue: JiraIssue; sprints: AnalyticsSprint[] } {
    const issue = raw as { id: string; key: string; fields?: Record<string, unknown>; changelog?: { histories?: ChangelogHistory[] } };
    const fields = issue.fields || {};
    const statusName = typeof fields.status === 'string'
      ? fields.status
      : String((fields.status as { name?: string } | undefined)?.name || 'Unknown');
    const hasSprintField = fields[env.JIRA_SPRINT_FIELD] != null || fields.sprint != null;
    const sprints = [
      ...parseSprints(fields[env.JIRA_SPRINT_FIELD]),
      ...parseSprints(fields.sprint),
      ...parseSprints(fields.closedSprints),
    ];
    const uniqueSprints = [...new Map(sprints.map((sprint) => [sprint.id, sprint])).values()].filter((sprint) => Number.isFinite(sprint.id));
    const resolved = (fields.resolutiondate as string | null | undefined) || null;
    const created = String(fields.created || '');
    const flow = deriveFlowTimestamps(created, resolved, issue.changelog?.histories || [], this.statusLookup);
    const assignee = fields.assignee as { displayName?: string } | undefined;

    return {
      sprints: uniqueSprints,
      issue: {
        id: String(issue.id),
        key: String(issue.key),
        summary: String(fields.summary || ''),
        status: statusName,
        statusCategory: categoryForStatus(statusName, this.statusLookup),
        issueType: (fields.issuetype as { name?: string } | undefined)?.name,
        projectKey: (fields.project as { key?: string } | undefined)?.key,
        created,
        updated: String(fields.updated || created),
        resolved,
        assignee: assignee?.displayName || null,
        storyPoints: parseStoryPoints(fields[env.JIRA_STORY_POINTS_FIELD]),
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

export const jiraClient = new JiraClient();

export const jiraDiagnostics = {
  domain: env.JIRA_DOMAIN,
  email: env.JIRA_EMAIL ? maskSecret(env.JIRA_EMAIL) : 'not-configured',
  apiToken: env.JIRA_API_TOKEN ? maskSecret(env.JIRA_API_TOKEN) : 'not-configured',
  oauthToken: env.JIRA_OAUTH_TOKEN ? maskSecret(env.JIRA_OAUTH_TOKEN) : 'not-configured',
  projectKey: env.JIRA_PROJECT_KEY || 'not-configured',
};

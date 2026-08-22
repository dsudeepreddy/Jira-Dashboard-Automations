import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { env, maskSecret } from '../config/env';
import { redisCache } from '../cache/redisClient';

export interface JiraProject { id: string; key: string; name: string; projectTypeKey?: string; }
export interface JiraSprint { id: number; name: string; state: string; }
export interface JiraIssueType { id: string; name: string; description?: string; }
export interface JiraIssueStatus { id: string; name: string; }

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  status?: string | { name?: string };
  created: string;
  updated: string;
  resolved?: string | null;
  issuetype?: { name?: string };
  project?: { key?: string; name?: string };
  priority?: { name?: string };
}

export class JiraClientError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'JiraClientError';
  }
}

export class JiraClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = `${env.JIRA_DOMAIN.replace(/\/+$/, '')}/rest/api/3`;
  }

  private async request<T>(path: string, options: AxiosRequestConfig = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };

    const hasToken = Boolean(env.JIRA_API_TOKEN);
    const hasOAuth = Boolean(env.JIRA_OAUTH_TOKEN);

    if (hasOAuth) {
      headers.Authorization = `Bearer ${env.JIRA_OAUTH_TOKEN}`;
    } else if (hasToken && env.JIRA_EMAIL) {
      const token = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
      headers.Authorization = `Basic ${token}`;
    } else {
      throw new JiraClientError(401, 'JIRA_AUTH_ERROR', 'Missing Jira authentication configuration.');
    }

    try {
      const response = await axios({
        ...options,
        baseURL: this.baseUrl,
        url: path,
        headers,
        timeout: 20000,
        validateStatus: (status) => status >= 200 && status < 500,
      });

      if (response.status >= 400) {
        const errorBody = response.data as { errorMessages?: string[]; errors?: Record<string, string> } | undefined;
        const detail = [
          ...(errorBody?.errorMessages || []),
          ...Object.values(errorBody?.errors || {}),
        ].filter(Boolean).join('; ');
        const retryAfter = response.headers['retry-after'];
        throw new JiraClientError(
          response.status,
          'JIRA_API_ERROR',
          `Jira request failed for ${path}${detail ? `: ${detail}` : ''}`,
          { data: response.data, retryAfter },
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
        if (!retryable || attempt === 3) {
          throw error;
        }
        const retryAfter = Number((jiraError.details as { retryAfter?: string } | undefined)?.retryAfter);
        const ms = Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(10000, 500 * 2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, ms));
        attempt += 1;
      }
    }
    throw new Error('Jira retry loop exhausted');
  }

  async getProjects(): Promise<JiraProject[]> {
    const cacheKey = 'jira:projects';
    const cached = await redisCache.get<JiraProject[]>(cacheKey);
    if (cached) return cached;

    const response = await this.withRetry(() => this.request<{ values: JiraProject[] }>('/project/search', {
      params: { maxResults: 200 },
    }));

    const projects = response.values ?? [];
    await redisCache.set(cacheKey, projects);
    return projects;
  }

  async getSprints(): Promise<JiraSprint[]> {
    if (!env.JIRA_BOARD_ID) return [];

    const cacheKey = 'jira:sprints';
    const cached = await redisCache.get<JiraSprint[]>(cacheKey);
    if (cached) return cached;

    const agileBaseUrl = `${env.JIRA_DOMAIN.replace(/\/+$/, '')}/rest/agile/1.0`;
    const response = await this.withRetry(() => this.request<{ values: JiraSprint[] }>(
      `${agileBaseUrl}/board/${env.JIRA_BOARD_ID}/sprint`,
      { params: { maxResults: 200 } },
    ));

    const sprints = response.values ?? [];
    await redisCache.set(cacheKey, sprints);
    return sprints;
  }

  async getIssueTypes(): Promise<JiraIssueType[]> {
    const cacheKey = 'jira:issueTypes';
    const cached = await redisCache.get<JiraIssueType[]>(cacheKey);
    if (cached) return cached;

    const response = await this.withRetry(() => this.request<JiraIssueType[]>('/issuetype'));
    const issueTypes = Array.isArray(response) ? response : [];
    await redisCache.set(cacheKey, issueTypes);
    return issueTypes;
  }

  async getIssueStatuses(): Promise<JiraIssueStatus[]> {
    const cacheKey = 'jira:statuses';
    const cached = await redisCache.get<JiraIssueStatus[]>(cacheKey);
    if (cached) return cached;

    const response = await this.withRetry(() => this.request<JiraIssueStatus[]>('/status'));
    const statuses = Array.isArray(response) ? response : [];
    await redisCache.set(cacheKey, statuses);
    return statuses;
  }

  async searchIssues(filters: {
    projectKey?: string;
    sprintId?: number;
    issueType?: string;
    startDate?: string;
    endDate?: string;
  } = {}): Promise<JiraIssue[]> {
    const parts: string[] = [];

    const projectKey = filters.projectKey || env.JIRA_PROJECT_KEY;
    if (projectKey) parts.push(`project = "${projectKey.replace(/"/g, '\\"')}"`);
    if (filters.sprintId) parts.push(`sprint = ${filters.sprintId}`);
    if (filters.issueType) parts.push(`issuetype = "${filters.issueType.replace(/"/g, '\\"')}"`);
    if (filters.startDate && filters.endDate) {
      parts.push(`created >= "${filters.startDate}" AND created <= "${filters.endDate}"`);
    }

    const jql = parts.length ? `${parts.join(' AND ')} ORDER BY created DESC` : 'created >= -30d ORDER BY created DESC';
    const issues: JiraIssue[] = [];
    let nextPageToken: string | undefined;

    while (issues.length < env.JIRA_MAX_ISSUES) {
      const page = await this.withRetry(() => this.request<{ issues: JiraIssue[]; isLast?: boolean; nextPageToken?: string }>('/search/jql', {
        method: 'POST',
        data: {
          jql,
          maxResults: Math.min(env.JIRA_PAGE_SIZE, env.JIRA_MAX_ISSUES - issues.length),
          nextPageToken,
          fields: ['summary', 'status', 'issuetype', 'created', 'updated', 'resolutiondate', 'project', 'priority'],
        },
      }));

      const pageIssues = page.issues ?? [];
      issues.push(...pageIssues);
      if (page.isLast || !page.nextPageToken || pageIssues.length === 0) break;
      nextPageToken = page.nextPageToken;
    }

    return issues.slice(0, env.JIRA_MAX_ISSUES).map((issue: any) => {
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

export const jiraClient = new JiraClient();

export const jiraDiagnostics = {
  domain: env.JIRA_DOMAIN,
  email: env.JIRA_EMAIL ? maskSecret(env.JIRA_EMAIL) : 'not-configured',
  apiToken: env.JIRA_API_TOKEN ? maskSecret(env.JIRA_API_TOKEN) : 'not-configured',
  oauthToken: env.JIRA_OAUTH_TOKEN ? maskSecret(env.JIRA_OAUTH_TOKEN) : 'not-configured',
  projectKey: env.JIRA_PROJECT_KEY || 'not-configured',
};

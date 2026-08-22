import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { JiraConfig, JiraIssue, JiraIssueStatusType, JiraIssueType, JiraProject, JiraSprint } from './types';

const DEFAULT_CACHE_TTL_MS = Number(process.env.JIRA_CACHE_TTL_MS || 60000);

class JiraApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'JiraApiError';
  }
}

function maskSecret(value?: string) {
  if (!value) return 'not-configured';
  if (value.length <= 8) return `${'*'.repeat(Math.max(value.length, 4))}`;
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`;
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, '');
}

const cache = new Map<string, { expiresAt: number; value: unknown }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCache<T>(key: string, value: T, ttlMs = DEFAULT_CACHE_TTL_MS) {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

export function getJiraConfig(): JiraConfig {
  const domain = process.env.JIRA_DOMAIN;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const oauthToken = process.env.JIRA_OAUTH_TOKEN || '';
  const projectKey = process.env.JIRA_PROJECT_KEY || '';

  if (!domain) {
    throw new Error('Missing required env var: JIRA_DOMAIN');
  }

  return {
    domain: normalizeBaseUrl(domain),
    email,
    apiToken,
    oauthToken: oauthToken || undefined,
    projectKey: projectKey || undefined,
  };
}

async function jiraRequest<T>(
  config: JiraConfig,
  path: string,
  options: AxiosRequestConfig = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  const hasOAuth = Boolean(config.oauthToken);
  const hasBasic = Boolean(config.email && config.apiToken);

  if (hasOAuth) {
    headers.Authorization = `Bearer ${config.oauthToken}`;
  } else if (hasBasic) {
    headers.Authorization = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;
  } else {
    throw new JiraApiError(401, 'CONFIG_ERROR', 'Jira credentials are not configured.');
  }

  const baseURL = `${config.domain}/rest/api/3`;
  const axiosConfig: AxiosRequestConfig = {
    ...options,
    baseURL,
    url: path,
    headers,
    validateStatus: (status) => status >= 200 && status < 500,
    timeout: 20000,
  };

  try {
    const response = await axios(axiosConfig);
    if (response.status >= 400) {
      throw new JiraApiError(response.status, 'JIRA_API_ERROR', `Jira API request failed for ${path}`, {
        statusText: response.statusText,
        data: response.data,
      });
    }

    return response.data as T;
  } catch (error) {
    if (error instanceof JiraApiError) throw error;

    const axiosError = error as AxiosError;
    const statusCode = axiosError.response?.status ?? 500;
    const details = axiosError.response?.data ?? axiosError.message;
    throw new JiraApiError(
      statusCode,
      'REQUEST_ERROR',
      `Failed to reach Jira API: ${axiosError.message}`,
      details,
    );
  }
}

async function withRetry<T>(
  operation: () => Promise<T>,
  retries = 3,
  delayMs = 500,
): Promise<T> {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await operation();
    } catch (error) {
      const jiraError = error as JiraApiError;
      const isRetryable = jiraError.statusCode === 429 || jiraError.statusCode >= 500;
      if (!isRetryable || attempt === retries) {
        throw error;
      }
      const backoffMs = delayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      attempt += 1;
    }
  }
  throw new Error('Retry loop exhausted');
}

export async function getProjects(config: JiraConfig): Promise<JiraProject[]> {
  const key = `projects:${config.domain}`;
  const cached = getCached<JiraProject[]>(key);
  if (cached) return cached;

  const response = await withRetry(async () =>
    jiraRequest<{ values: JiraProject[] }>(config, '/project/search', { params: { maxResults: 200 } }),
  );

  const projects = (response.values || []).map((project) => ({
    id: project.id,
    key: project.key,
    name: project.name,
    projectTypeKey: project.projectTypeKey,
  }));

  setCache(key, projects);
  return projects;
}

export async function getSprints(config: JiraConfig): Promise<JiraSprint[]> {
  const key = `sprints:${config.domain}`;
  const cached = getCached<JiraSprint[]>(key);
  if (cached) return cached;

  const response = await withRetry(async () =>
    jiraRequest<{ values: JiraSprint[] }>(config, '/sprint', { params: { maxResults: 200 } }),
  );

  const sprints = (response.values || []).map((sprint) => ({
    id: sprint.id,
    name: sprint.name,
    state: sprint.state,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    completeDate: sprint.completeDate,
  }));

  setCache(key, sprints);
  return sprints;
}

export async function getIssueTypes(config: JiraConfig): Promise<JiraIssueType[]> {
  const key = `issue-types:${config.domain}`;
  const cached = getCached<JiraIssueType[]>(key);
  if (cached) return cached;

  const response = await withRetry(async () => jiraRequest<JiraIssueType[]>(config, '/issuetype'));
  const issueTypes = Array.isArray(response) ? response.map((issueType) => ({
    id: issueType.id,
    name: issueType.name,
    description: issueType.description,
  })) : [];

  setCache(key, issueTypes);
  return issueTypes;
}

export async function getIssueStatuses(config: JiraConfig): Promise<JiraIssueStatusType[]> {
  const key = `issue-statuses:${config.domain}`;
  const cached = getCached<JiraIssueStatusType[]>(key);
  if (cached) return cached;

  const response = await withRetry(async () => jiraRequest<JiraIssueStatusType[]>(config, '/status'));
  const statuses = Array.isArray(response) ? response.map((status) => ({
    id: status.id,
    name: status.name,
    statusCategory: status.statusCategory,
  })) : [];

  setCache(key, statuses);
  return statuses;
}

export async function searchIssues(
  config: JiraConfig,
  filters: {
    projectKey?: string;
    sprintId?: number;
    issueType?: string;
    startDate?: string;
    endDate?: string;
  },
): Promise<JiraIssue[]> {
  const jqlParts: string[] = [];

  if (filters.projectKey) {
    jqlParts.push(`project = "${filters.projectKey}"`);
  }

  if (filters.sprintId) {
    jqlParts.push(`sprint = ${filters.sprintId}`);
  }

  if (filters.issueType) {
    jqlParts.push(`issueType = "${filters.issueType}"`);
  }

  if (filters.startDate && filters.endDate) {
    jqlParts.push(`created >= \"${filters.startDate}\" AND created <= \"${filters.endDate}\"`);
  }

  const jql = jqlParts.length ? jqlParts.join(' AND ') : 'ORDER BY created DESC';
  const response = await withRetry(async () =>
    jiraRequest<{ issues: JiraIssue[] }>(config, '/search', {
      params: {
        jql,
        maxResults: 200,
        fields: [
          'summary',
          'status',
          'issuetype',
          'created',
          'updated',
          'resolved',
          'project',
          'priority',
          'assignee',
          'customfield_10020',
        ].join(','),
      },
    }),
  );

  return (response.issues || []).map((issue) => ({
    id: issue.id,
    key: issue.key,
    summary: issue.summary,
    status: typeof issue.status === 'string' ? issue.status : issue.status?.name || 'Unknown',
    issuetype: issue.issuetype,
    created: issue.created,
    updated: issue.updated,
    resolved: issue.resolved,
    project: issue.project,
    priority: issue.priority,
    assignee: issue.assignee,
    customfield_10020: issue.customfield_10020,
  }));
}

export function getLogMetadata() {
  const config = getJiraConfig();
  return {
    domain: config.domain,
    email: config.email ? maskSecret(config.email) : 'not-configured',
    apiToken: config.apiToken ? maskSecret(config.apiToken) : 'not-configured',
    oauthToken: config.oauthToken ? maskSecret(config.oauthToken) : 'not-configured',
    projectKey: config.projectKey || 'not-configured',
  };
}

export { JiraApiError, maskSecret };

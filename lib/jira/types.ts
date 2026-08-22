export type JiraIssueStatus = 'Open' | 'In Progress' | 'In Review' | 'Completed' | 'Closed' | 'Blocked' | 'To Do' | 'Done' | 'Reopened';

export interface JiraConfig {
  domain: string;
  email?: string;
  apiToken?: string;
  oauthToken?: string;
  projectKey?: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  description?: string;
}

export interface JiraIssueStatusType {
  id: string;
  name: string;
  statusCategory?: {
    key: string;
    name: string;
  };
}

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  status?: string | { name?: string };
  issuetype?: {
    name?: string;
  };
  created: string;
  updated: string;
  resolved?: string | null;
  project?: {
    key?: string;
    name?: string;
  };
  priority?: {
    name?: string;
  };
  assignee?: {
    displayName?: string;
    emailAddress?: string;
  };
  customfield_10020?: number | string | null;
}

export interface DashboardFilters {
  projectKey?: string;
  sprintId?: number;
  issueType?: string;
  startDate?: string;
  endDate?: string;
}

export interface DashboardMetrics {
  totalIssues: number;
  completionRate: number;
  velocity: number;
  avgCycleTimeDays: number;
  createdVsResolved: Array<{ period: string; created: number; resolved: number }>;
  statusBreakdown: Array<{ name: string; value: number; color: string }>;
  velocityTrend: Array<{ period: string; target: number; actual: number }>;
}

export interface JiraApiResponse<T> {
  data: T;
  meta?: {
    cached?: boolean;
    source?: string;
  };
}

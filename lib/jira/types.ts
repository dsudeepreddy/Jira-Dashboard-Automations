export type {
  DashboardFilters,
  DashboardIssue,
  DashboardMetrics,
  DashboardPayload,
  IssuePagePayload,
} from '@/shared/dashboardContract';

export type {
  AnalyticsIssue as JiraIssue,
  AnalyticsSprint as JiraSprint,
} from '@/shared/analytics';

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

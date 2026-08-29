import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { jiraClient } from '../services/jiraClient';
import { getStoredIssuesPage } from '../db/jiraRepository';
import { isDatabaseEnabled } from '../db/database';

export const ISSUE_SORTS = {
  'updated-desc': { label: 'Latest updated', jql: 'updated DESC', sql: 'i.updated_at DESC', field: 'updated' as const, dir: -1 },
  'updated-asc': { label: 'Oldest updated', jql: 'updated ASC', sql: 'i.updated_at ASC', field: 'updated' as const, dir: 1 },
  'created-desc': { label: 'Latest created', jql: 'created DESC', sql: 'i.created_at DESC', field: 'created' as const, dir: -1 },
  'created-asc': { label: 'Oldest created', jql: 'created ASC', sql: 'i.created_at ASC', field: 'created' as const, dir: 1 },
  'key-asc': { label: 'Key A–Z', jql: 'key ASC', sql: 'i.issue_key ASC', field: 'key' as const, dir: 1 },
  'key-desc': { label: 'Key Z–A', jql: 'key DESC', sql: 'i.issue_key DESC', field: 'key' as const, dir: -1 },
} as const;

export type IssueSort = keyof typeof ISSUE_SORTS;

function compareIssues<T extends { key: string; created: string; updated: string }>(left: T, right: T, sort: IssueSort) {
  const spec = ISSUE_SORTS[sort];
  const a = spec.field === 'key' ? left.key : left[spec.field];
  const b = spec.field === 'key' ? right.key : right[spec.field];
  if (a < b) return -1 * spec.dir;
  if (a > b) return 1 * spec.dir;
  return 0;
}

const querySchema = z.object({
  projectKey: z.string().optional(),
  sprintId: z.coerce.number().int().positive().optional(),
  issueType: z.string().optional(),
  label: z.string().optional(),
  epicKey: z.string().optional(),
  licenseBu: z.string().optional(),
  auditType: z.string().optional(),
  application: z.string().optional(),
  startDate: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  endDate: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  sort: z.enum(['updated-desc', 'updated-asc', 'created-desc', 'created-asc', 'key-asc', 'key-desc']).default('updated-desc'),
});

export async function getIssuesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = querySchema.parse(req.query);
    const sort = parsed.sort;
    let issues: Array<{
      id: string;
      key: string;
      summary: string;
      status?: string;
      created: string;
      updated: string;
      resolved?: string | null;
      issueType?: string;
      projectKey?: string;
      assignee?: string | null;
      storyPoints?: number | null;
      flagged?: boolean;
    }>;
    let total: number;

    if (isDatabaseEnabled()) {
      const result = await getStoredIssuesPage(parsed, parsed.page, parsed.pageSize, ISSUE_SORTS[sort].sql);
      issues = result.issues;
      total = result.total;
    } else {
      const searched = await jiraClient.searchIssues({ ...parsed, orderBy: ISSUE_SORTS[sort].jql });
      const sorted = [...searched.issues].sort((left, right) => compareIssues(left, right, sort));
      const start = (parsed.page - 1) * parsed.pageSize;
      issues = sorted.slice(start, start + parsed.pageSize);
      total = searched.issues.length;
    }

    const comments = await jiraClient.getLatestHumanComments(issues.map((issue) => issue.key)).catch(() => new Map());
    return res.json({
      issues: issues.map((issue) => ({
        id: issue.id,
        key: issue.key,
        summary: issue.summary,
        status: issue.status,
        created: issue.created,
        updated: issue.updated,
        resolved: issue.resolved,
        issuetype: issue.issueType ? { name: issue.issueType } : undefined,
        project: issue.projectKey ? { key: issue.projectKey } : undefined,
        assignee: issue.assignee,
        storyPoints: issue.storyPoints,
        flagged: issue.flagged,
        latestComment: comments.get(issue.key) || null,
      })),
      page: parsed.page,
      pageSize: parsed.pageSize,
      total,
      sort,
      requestId: res.locals.requestId,
    });
  } catch (error) {
    next(error);
  }
}

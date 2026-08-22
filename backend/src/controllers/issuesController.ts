import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { jiraClient } from '../services/jiraClient';
import { getStoredIssuesPage } from '../db/jiraRepository';
import { isDatabaseEnabled } from '../db/database';

const querySchema = z.object({
  projectKey: z.string().optional(),
  sprintId: z.coerce.number().int().positive().optional(),
  issueType: z.string().optional(),
  startDate: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  endDate: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

export async function getIssuesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = querySchema.parse(req.query);
    if (isDatabaseEnabled()) {
      const result = await getStoredIssuesPage(parsed, parsed.page, parsed.pageSize);
      return res.json({
        issues: result.issues.map((issue) => ({
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
        })),
        page: parsed.page,
        pageSize: parsed.pageSize,
        total: result.total,
        requestId: res.locals.requestId,
      });
    }

    const { issues } = await jiraClient.searchIssues(parsed);
    const start = (parsed.page - 1) * parsed.pageSize;
    const pageIssues = issues.slice(start, start + parsed.pageSize);
    return res.json({
      issues: pageIssues.map((issue) => ({
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
      })),
      page: parsed.page,
      pageSize: parsed.pageSize,
      total: issues.length,
      requestId: res.locals.requestId,
    });
  } catch (error) {
    next(error);
  }
}

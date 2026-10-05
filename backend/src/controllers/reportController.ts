import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendMonthlyReport, sendWeeklyReport } from '../services/monthlyReportService';

const monthlyBodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  projectKey: z.string().optional(),
  to: z.string().optional(),
  dryRun: z.boolean().optional(),
});

const weeklyBodySchema = z.object({
  projectKey: z.string().optional(),
  to: z.string().optional(),
  dryRun: z.boolean().optional(),
});

function respondReport(
  res: Response,
  result: Awaited<ReturnType<typeof sendMonthlyReport>>,
  dryRun: boolean,
) {
  const { attachment, ...rest } = result as typeof result & {
    attachment?: { filename: string; content?: Buffer; contentType?: string; bytes?: number };
  };
  const safeAttachment = attachment
    ? {
        filename: attachment.filename,
        contentType: attachment.contentType,
        bytes: attachment.bytes ?? attachment.content?.length,
      }
    : undefined;
  return res.status(dryRun ? 200 : 202).json({
    status: dryRun ? 'preview' : 'sent',
    ...rest,
    attachment: safeAttachment,
    requestId: res.locals.requestId,
  });
}

export async function sendMonthlyReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    console.log(JSON.stringify({
      event: 'monthly_report_http_accepted',
      requestId: res.locals.requestId,
      dryRun: req.body?.dryRun === true || req.query.dryRun === 'true' || req.query.dryRun === '1',
      month: req.body?.month || req.query.month || null,
    }));

    const parsed = monthlyBodySchema.parse({
      ...req.body,
      dryRun: req.body?.dryRun === true || req.query.dryRun === 'true' || req.query.dryRun === '1',
      month: req.body?.month || (typeof req.query.month === 'string' ? req.query.month : undefined),
      projectKey: req.body?.projectKey || (typeof req.query.projectKey === 'string' ? req.query.projectKey : undefined),
      to: req.body?.to || (typeof req.query.to === 'string' ? req.query.to : undefined),
    });

    const result = await sendMonthlyReport(parsed);
    return respondReport(res, result, Boolean(parsed.dryRun));
  } catch (error) {
    next(error);
  }
}

export async function sendWeeklyReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    console.log(JSON.stringify({
      event: 'weekly_report_http_accepted',
      requestId: res.locals.requestId,
      dryRun: req.body?.dryRun === true || req.query.dryRun === 'true' || req.query.dryRun === '1',
    }));

    const parsed = weeklyBodySchema.parse({
      ...req.body,
      dryRun: req.body?.dryRun === true || req.query.dryRun === 'true' || req.query.dryRun === '1',
      projectKey: req.body?.projectKey || (typeof req.query.projectKey === 'string' ? req.query.projectKey : undefined),
      to: req.body?.to || (typeof req.query.to === 'string' ? req.query.to : undefined),
    });

    const result = await sendWeeklyReport(parsed);
    return respondReport(res, result, Boolean(parsed.dryRun));
  } catch (error) {
    next(error);
  }
}

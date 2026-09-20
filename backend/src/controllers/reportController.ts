import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendMonthlyReport } from '../services/monthlyReportService';

const bodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  projectKey: z.string().optional(),
  to: z.string().optional(),
  dryRun: z.boolean().optional(),
});

export async function sendMonthlyReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = bodySchema.parse({
      ...req.body,
      dryRun: req.body?.dryRun === true || req.query.dryRun === 'true' || req.query.dryRun === '1',
      month: req.body?.month || (typeof req.query.month === 'string' ? req.query.month : undefined),
      projectKey: req.body?.projectKey || (typeof req.query.projectKey === 'string' ? req.query.projectKey : undefined),
      to: req.body?.to || (typeof req.query.to === 'string' ? req.query.to : undefined),
    });

    const result = await sendMonthlyReport(parsed);
    return res.status(parsed.dryRun ? 200 : 202).json({
      status: parsed.dryRun ? 'preview' : 'sent',
      ...result,
      requestId: res.locals.requestId,
    });
  } catch (error) {
    next(error);
  }
}

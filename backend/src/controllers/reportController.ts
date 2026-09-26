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
    console.log(JSON.stringify({
      event: 'monthly_report_http_accepted',
      requestId: res.locals.requestId,
      dryRun: req.body?.dryRun === true || req.query.dryRun === 'true' || req.query.dryRun === '1',
      month: req.body?.month || req.query.month || null,
    }));

    const parsed = bodySchema.parse({
      ...req.body,
      dryRun: req.body?.dryRun === true || req.query.dryRun === 'true' || req.query.dryRun === '1',
      month: req.body?.month || (typeof req.query.month === 'string' ? req.query.month : undefined),
      projectKey: req.body?.projectKey || (typeof req.query.projectKey === 'string' ? req.query.projectKey : undefined),
      to: req.body?.to || (typeof req.query.to === 'string' ? req.query.to : undefined),
    });

    const result = await sendMonthlyReport(parsed);
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
    return res.status(parsed.dryRun ? 200 : 202).json({
      status: parsed.dryRun ? 'preview' : 'sent',
      ...rest,
      attachment: safeAttachment,
      requestId: res.locals.requestId,
    });
  } catch (error) {
    next(error);
  }
}

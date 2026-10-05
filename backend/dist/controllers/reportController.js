"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMonthlyReportHandler = sendMonthlyReportHandler;
exports.sendWeeklyReportHandler = sendWeeklyReportHandler;
const zod_1 = require("zod");
const monthlyReportService_1 = require("../services/monthlyReportService");
const monthlyBodySchema = zod_1.z.object({
    month: zod_1.z.string().regex(/^\d{4}-\d{2}$/).optional(),
    projectKey: zod_1.z.string().optional(),
    to: zod_1.z.string().optional(),
    dryRun: zod_1.z.boolean().optional(),
});
const weeklyBodySchema = zod_1.z.object({
    projectKey: zod_1.z.string().optional(),
    to: zod_1.z.string().optional(),
    dryRun: zod_1.z.boolean().optional(),
});
function respondReport(res, result, dryRun) {
    const { attachment, ...rest } = result;
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
async function sendMonthlyReportHandler(req, res, next) {
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
        const result = await (0, monthlyReportService_1.sendMonthlyReport)(parsed);
        return respondReport(res, result, Boolean(parsed.dryRun));
    }
    catch (error) {
        next(error);
    }
}
async function sendWeeklyReportHandler(req, res, next) {
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
        const result = await (0, monthlyReportService_1.sendWeeklyReport)(parsed);
        return respondReport(res, result, Boolean(parsed.dryRun));
    }
    catch (error) {
        next(error);
    }
}

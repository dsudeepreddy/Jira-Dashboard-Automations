import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildMonthlyReport,
  monthWindowFromYm,
  previousMonthWindow,
  monthlyReportSubject,
  monthlyReportIntro,
} = require('./.tmp/monthlyReport.js');

test('previousMonthWindow and monthWindowFromYm use calendar months', () => {
  const window = previousMonthWindow(new Date('2026-09-17T12:00:00.000Z'));
  assert.equal(window.startDate, '2026-08-01');
  assert.equal(window.endDate, '2026-08-31');
  assert.equal(window.periodLabel, 'August 2026');

  const explicit = monthWindowFromYm('2026-02');
  assert.equal(explicit.startDate, '2026-02-01');
  assert.equal(explicit.endDate, '2026-02-28');
});

test('buildMonthlyReport counts opened/closed by audit type and SLAs', () => {
  const issues = [
    {
      id: '1',
      key: 'AUD-1',
      summary: 'Opened and closed SOX',
      status: 'Done',
      statusCategory: 'done',
      created: '2026-08-05T10:00:00.000Z',
      updated: '2026-08-20T10:00:00.000Z',
      resolved: '2026-08-20T10:00:00.000Z',
      auditType: ['SOX'],
      application: ['Checkout'],
      approvedAt: '2026-08-08T00:00:00.000Z',
      underValidationAt: '2026-08-12T00:00:00.000Z',
      doneAt: '2026-08-20T10:00:00.000Z',
      teamSlaDays: 4,
      reviewerSlaDays: 8.4,
    },
    {
      id: '2',
      key: 'AUD-2',
      summary: 'Opened ISO still open overdue',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      created: '2026-08-10T10:00:00.000Z',
      updated: '2026-08-15T10:00:00.000Z',
      auditType: ['ISO'],
      application: ['Ledger'],
      approvedAt: '2026-08-01T00:00:00.000Z',
      underValidationAt: null,
      teamSlaDays: null,
      reviewerSlaDays: null,
    },
    {
      id: '3',
      key: 'AUD-3',
      summary: 'Outside month',
      status: 'Done',
      statusCategory: 'done',
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-10T00:00:00.000Z',
      resolved: '2026-07-10T00:00:00.000Z',
      auditType: ['SOX'],
      application: ['Checkout'],
    },
    {
      id: '4',
      key: 'AUD-4',
      summary: 'Untagged opened/closed — must not create (none) bucket',
      status: 'Done',
      statusCategory: 'done',
      created: '2026-08-03T10:00:00.000Z',
      updated: '2026-08-18T10:00:00.000Z',
      resolved: '2026-08-18T10:00:00.000Z',
      auditType: [],
      application: [],
      approvedAt: '2026-08-04T00:00:00.000Z',
      underValidationAt: '2026-08-06T00:00:00.000Z',
      doneAt: '2026-08-18T10:00:00.000Z',
      teamSlaDays: 2,
      reviewerSlaDays: 10,
    },
    {
      id: '5',
      key: 'AUD-5',
      summary: 'Placeholder audit type label ignored',
      status: 'To Do',
      statusCategory: 'new',
      created: '2026-08-12T10:00:00.000Z',
      updated: '2026-08-12T10:00:00.000Z',
      auditType: ['none', '(none)', '  '],
      application: ['None'],
    },
  ];

  const report = buildMonthlyReport(issues, {
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    periodLabel: 'August 2026',
    projectKey: 'AUD',
    now: new Date('2026-09-01T00:00:00.000Z'),
  });

  assert.equal(report.totals.opened, 4);
  assert.equal(report.totals.closed, 2);
  assert.equal(report.totals.netChange, 2);
  assert.equal(report.byAuditType.find((row) => row.auditType === 'SOX')?.opened, 1);
  assert.equal(report.byAuditType.find((row) => row.auditType === 'SOX')?.closed, 1);
  assert.equal(report.byAuditType.find((row) => row.auditType === 'ISO')?.opened, 1);
  assert.equal(report.byAuditType.some((row) => /none/i.test(row.auditType)), false);
  assert.equal(report.topApplications.some((row) => /none/i.test(row.name)), false);
  // Untagged ticket still contributes to overall SLA averages
  assert.equal(report.teamSlaOverall.avgDays, 3);
  assert.equal(report.teamSlaOverall.count, 2);
  assert.equal(report.reviewerSlaOverall.avgDays, 9.2);
  assert.equal(report.reviewerSlaOverall.count, 2);
  assert.ok(report.topBreaches.some((row) => row.key === 'AUD-2' && row.kind === 'team'));
  assert.equal(monthlyReportSubject(report), 'SRE Audit Monthly Jira Report — August 2026 · AUD');
  assert.match(monthlyReportIntro(report), /opened 4, closed 2/i);
});

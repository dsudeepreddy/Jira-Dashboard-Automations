import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isoWeekKey,
  aggregateDashboardMetrics,
  categoryForStatus,
  deriveFlowTimestamps,
  calculateValidationTime,
} = require('./.tmp/analytics.js');

test('calculateValidationTime correctly tracks duration in validation statuses', () => {
  const created = '2026-01-01T00:00:00.000Z';
  const resolved = '2026-01-10T00:00:00.000Z';

  // Transition sequence:
  // 2026-01-01 (created): To Do
  // 2026-01-03: In Progress
  // 2026-01-05: Under Validation (enters validation stage)
  // 2026-01-08: Done (leaves validation stage)
  // Total in validation: 3 days (01-05 to 01-08)
  const histories = [
    { created: '2026-01-03T00:00:00.000Z', items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }] },
    { created: '2026-01-05T00:00:00.000Z', items: [{ field: 'status', fromString: 'In Progress', toString: 'Under Validation' }] },
    { created: '2026-01-08T00:00:00.000Z', items: [{ field: 'status', fromString: 'Under Validation', toString: 'Done' }] },
  ];

  const days = calculateValidationTime(created, resolved, 'Done', histories);
  assert.equal(days, 3);
});

test('isoWeekKey uses ISO week-year, not calendar-month weeks', () => {
  assert.equal(isoWeekKey(new Date('2026-01-01T12:00:00.000Z')), '2026-W01');
  assert.equal(isoWeekKey(new Date('2026-12-31T12:00:00.000Z')), '2026-W53');
});

test('categoryForStatus maps common Jira names', () => {
  assert.equal(categoryForStatus('In Progress'), 'indeterminate');
  assert.equal(categoryForStatus('Done'), 'done');
  assert.equal(categoryForStatus('To Do'), 'new');
});

test('deriveFlowTimestamps uses first In Progress transition', () => {
  const flow = deriveFlowTimestamps('2026-01-01T00:00:00.000Z', '2026-01-10T00:00:00.000Z', [
    { created: '2026-01-03T00:00:00.000Z', items: [{ field: 'status', toString: 'In Progress' }] },
    { created: '2026-01-10T00:00:00.000Z', items: [{ field: 'status', toString: 'Done' }] },
  ]);
  assert.equal(flow.inProgressAt, '2026-01-03T00:00:00.000Z');
});

test('aggregateDashboardMetrics uses sprint points, cycle time, and in-progress WIP', () => {
  const now = new Date('2026-02-01T00:00:00.000Z');
  const metrics = aggregateDashboardMetrics(
    [
      {
        id: '1',
        key: 'APP-1',
        summary: 'Done story',
        status: 'Done',
        statusCategory: 'done',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-08T00:00:00.000Z',
        resolved: '2026-01-08T00:00:00.000Z',
        inProgressAt: '2026-01-04T00:00:00.000Z',
        storyPoints: 5,
        sprintIds: [10],
        assignee: 'Ada',
      },
      {
        id: '2',
        key: 'APP-2',
        summary: 'Aging WIP',
        status: 'In Progress',
        statusCategory: 'indeterminate',
        created: '2026-01-10T00:00:00.000Z',
        updated: '2026-01-10T00:00:00.000Z',
        inProgressAt: '2026-01-10T00:00:00.000Z',
        lastStatusChangedAt: '2026-01-10T00:00:00.000Z',
        storyPoints: 3,
        assignee: 'Ada',
        flagged: true,
      },
      {
        id: '3',
        key: 'APP-3',
        summary: 'Backlog item is not WIP',
        status: 'To Do',
        statusCategory: 'new',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
        assignee: 'Lin',
      },
    ],
    [{ id: 10, name: 'Sprint 10', state: 'closed', completeDate: '2026-01-15T00:00:00.000Z' }],
    {},
    undefined,
    now,
  );

  assert.equal(metrics.velocityUnit, 'points');
  assert.equal(metrics.velocity, 5);
  assert.equal(metrics.avgCycleTimeDays, 4);
  assert.equal(metrics.avgLeadTimeDays, 7);
  assert.equal(metrics.blockedCount, 1);
  assert.equal(metrics.wipAging.find((row) => row.bucket === '14d+')?.count, 1);
  assert.equal(metrics.wipAging.reduce((sum, row) => sum + row.count, 0), 1);
  assert.equal(metrics.forecast.remainingIssues, 2);
  assert.equal(metrics.assigneeLoad[0].name, 'Ada');
  assert.equal(metrics.velocityBasis, 'sprint');
});

test('fieldMetrics rolls up labels, priority, and other fields', () => {
  const metrics = aggregateDashboardMetrics(
    [
      {
        id: '1',
        key: 'APP-1',
        summary: 'Tagged done',
        status: 'Done',
        statusCategory: 'done',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-02T00:00:00.000Z',
        resolved: '2026-01-02T00:00:00.000Z',
        labels: ['payments', 'p1'],
        components: ['Checkout'],
        priority: 'High',
        issueType: 'Story',
        projectKey: 'APP',
        storyPoints: 5,
      },
      {
        id: '2',
        key: 'APP-2',
        summary: 'Tagged open',
        status: 'To Do',
        statusCategory: 'new',
        created: '2026-01-03T00:00:00.000Z',
        updated: '2026-01-03T00:00:00.000Z',
        labels: ['payments'],
        priority: 'Low',
        issueType: 'Bug',
        projectKey: 'APP',
      },
      {
        id: '3',
        key: 'APP-3',
        summary: 'No tags',
        status: 'To Do',
        statusCategory: 'new',
        created: '2026-01-04T00:00:00.000Z',
        updated: '2026-01-04T00:00:00.000Z',
        projectKey: 'APP',
      },
    ],
    [],
    {},
    undefined,
    new Date('2026-02-01T00:00:00.000Z'),
  );

  assert.equal(metrics.fieldMetrics.uniqueLabels, 2);
  assert.equal(metrics.fieldMetrics.labeledIssues, 2);
  assert.equal(metrics.fieldMetrics.unlabeledIssues, 1);
  const payments = metrics.fieldMetrics.labels.find((row) => row.name === 'payments');
  assert.equal(payments?.count, 2);
  assert.equal(payments?.doneCount, 1);
  assert.equal(payments?.openCount, 1);
  assert.equal(payments?.points, 5);
  assert.equal(metrics.fieldMetrics.priorities.find((row) => row.name === 'High')?.count, 1);
  assert.equal(metrics.fieldMetrics.issueTypes.find((row) => row.name === 'Bug')?.count, 1);
  assert.equal(metrics.fieldMetrics.components[0].name, 'Checkout');
});

test('label filter scopes metrics to matching tags, including untagged', () => {
  const { UNTAGGED_LABEL } = require('./.tmp/dashboardContract.js');
  const issues = [
    { id: '1', key: 'APP-1', summary: 'A', status: 'To Do', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z', labels: ['payments'] },
    { id: '2', key: 'APP-2', summary: 'B', status: 'To Do', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z', labels: ['checkout', 'payments'] },
    { id: '3', key: 'APP-3', summary: 'C', status: 'To Do', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' },
  ];
  assert.equal(aggregateDashboardMetrics(issues, [], { label: 'payments' }).totalIssues, 2);
  assert.equal(aggregateDashboardMetrics(issues, [], { label: 'checkout' }).totalIssues, 1);
  assert.equal(aggregateDashboardMetrics(issues, [], { label: UNTAGGED_LABEL }).totalIssues, 1);
});

test('audit fields and FY epic filter the dashboard', () => {
  const issues = [
    {
      id: '1', key: 'AUD-1', summary: 'A', status: 'To Do',
      created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
      licenseBu: ['Payments'], auditType: ['SOX'], application: ['Checkout'], epicKey: 'AUD-FY26', epicName: 'FY26 Audit',
    },
    {
      id: '2', key: 'AUD-2', summary: 'B', status: 'To Do',
      created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
      licenseBu: ['Lending'], auditType: ['ISO'], application: ['Ledger'], epicKey: 'AUD-FY26', epicName: 'FY26 Audit',
    },
    {
      id: '3', key: 'AUD-3', summary: 'C', status: 'To Do',
      created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
      licenseBu: ['Payments'], auditType: ['SOX'], application: ['Checkout'], epicKey: 'AUD-FY25', epicName: 'FY25 Audit',
    },
  ];
  const fy26 = aggregateDashboardMetrics(issues, [], { epicKey: 'AUD-FY26' });
  assert.equal(fy26.totalIssues, 2);
  assert.equal(fy26.fieldMetrics.uniqueLicenseBus, 2);
  assert.equal(aggregateDashboardMetrics(issues, [], { licenseBu: 'Payments' }).totalIssues, 2);
  assert.equal(aggregateDashboardMetrics(issues, [], { auditType: 'SOX', application: 'Checkout', epicKey: 'AUD-FY26' }).totalIssues, 1);
});

test('velocity falls back to ISO weeks when sprint membership is missing', () => {
  const metrics = aggregateDashboardMetrics(
    [
      {
        id: '1',
        key: 'APP-1',
        summary: 'Done',
        status: 'Done',
        statusCategory: 'done',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-08T00:00:00.000Z',
        resolved: '2026-01-08T00:00:00.000Z',
        storyPoints: 3,
      },
    ],
    [],
    {},
    undefined,
    new Date('2026-02-01T00:00:00.000Z'),
  );
  assert.equal(metrics.velocityBasis, 'week');
  assert.equal(metrics.velocityTrend[0].period, '2026-W02');
  assert.equal(metrics.velocityTrend[0].actual, 3);
});

test('audit insights include stage completion, SLAs, and breach lists', () => {
  const { deriveAuditSlaTimestamps, aggregateDashboardMetrics } = require('./.tmp/analytics.js');

  const histories = [
    {
      created: '2026-01-05T00:00:00.000Z',
      items: [{ field: 'status', fromString: 'To Do', toString: 'Approved' }],
    },
    {
      created: '2026-01-12T00:00:00.000Z',
      items: [{ field: 'status', fromString: 'Approved', toString: 'Under Validation' }],
    },
    {
      created: '2026-01-15T00:00:00.000Z',
      items: [{ field: 'status', fromString: 'Under Validation', toString: 'Done' }],
    },
  ];
  const sla = deriveAuditSlaTimestamps('2026-01-01T00:00:00.000Z', '2026-01-15T00:00:00.000Z', 'Done', histories);
  assert.equal(sla.teamSlaDays, 7);
  assert.equal(sla.reviewerSlaDays, 3);

  const issues = [
    {
      id: '1',
      key: 'AUD-1',
      summary: 'SOX A',
      status: 'Done',
      statusCategory: 'done',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-15T00:00:00.000Z',
      resolved: '2026-01-15T00:00:00.000Z',
      assignee: 'Alex',
      auditType: ['SOX'],
      application: ['Checkout'],
      approvedAt: sla.approvedAt,
      underValidationAt: sla.underValidationAt,
      doneAt: sla.doneAt,
      teamSlaDays: sla.teamSlaDays,
      reviewerSlaDays: sla.reviewerSlaDays,
      validationDays: 3,
    },
    {
      id: '2',
      key: 'AUD-2',
      summary: 'SOX B overdue',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-10T00:00:00.000Z',
      assignee: 'Blair',
      auditType: ['SOX'],
      application: ['Ledger'],
      approvedAt: '2026-01-01T00:00:00.000Z',
      underValidationAt: null,
      doneAt: null,
      teamSlaDays: null,
      reviewerSlaDays: null,
      validationDays: 0,
    },
    {
      id: '3',
      key: 'AUD-3',
      summary: 'ISO',
      status: 'On Hold',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
      auditType: ['ISO'],
      application: ['Checkout'],
      teamSlaDays: 4,
      reviewerSlaDays: 2,
    },
  ];

  const metrics = aggregateDashboardMetrics(
    issues,
    [],
    {},
    undefined,
    new Date('2026-01-20T00:00:00.000Z'),
  );
  assert.ok(metrics.auditInsights);
  assert.equal(metrics.auditInsights.workByAuditType.length, 2);
  const soxStages = metrics.auditInsights.statusByAuditType.find((row) => row.auditType === 'SOX');
  assert.ok(soxStages);
  assert.equal(soxStages.total, 2);
  assert.ok(soxStages.stages.find((stage) => stage.name === 'Done')?.value >= 1);
  assert.equal(metrics.teamSlaByAuditType.find((row) => row.auditType === 'SOX')?.avgDays, 7);
  assert.equal(metrics.reviewerSlaByAuditType.find((row) => row.auditType === 'SOX')?.avgDays, 3);
  assert.ok(metrics.auditInsights.teamSlaBreaches.some((ticket) => ticket.key === 'AUD-2'));
  assert.equal(metrics.auditInsights.teamSlaBreaches.some((ticket) => ticket.key === 'AUD-1'), false);
});

test('createdDateJql applies each bound independently and makes the end date inclusive', () => {
  const { createdDateJql, shiftIsoDate } = require('./.tmp/analytics.js');
  assert.equal(shiftIsoDate('2026-08-23', 1), '2026-08-24');
  assert.equal(createdDateJql('2026-08-21', '2026-08-23'), 'created >= "2026-08-21" AND created < "2026-08-24"');
  assert.equal(createdDateJql('2026-08-21', undefined), 'created >= "2026-08-21"');
  assert.equal(createdDateJql(undefined, '2026-08-23'), 'created < "2026-08-24"');
  assert.equal(createdDateJql(undefined, undefined), null);
});

test('date filters are inclusive and still apply when a sprint is selected', () => {
  const issues = [
    { id: '1', key: 'APP-1', summary: 'Day 21', status: 'To Do', created: '2026-08-21T08:00:00.000Z', updated: '2026-08-21T08:00:00.000Z', sprintIds: [7] },
    { id: '2', key: 'APP-2', summary: 'Day 23', status: 'To Do', created: '2026-08-23T18:00:00.000Z', updated: '2026-08-23T18:00:00.000Z', sprintIds: [7] },
    { id: '3', key: 'APP-3', summary: 'Day 24', status: 'To Do', created: '2026-08-24T08:00:00.000Z', updated: '2026-08-24T08:00:00.000Z', sprintIds: [7] },
  ];

  const sameDay = aggregateDashboardMetrics(issues, [], { startDate: '2026-08-23', endDate: '2026-08-23' });
  assert.equal(sameDay.totalIssues, 1);

  const startOnly = aggregateDashboardMetrics(issues, [], { startDate: '2026-08-23' });
  assert.equal(startOnly.totalIssues, 2);

  const sprintAndDates = aggregateDashboardMetrics(issues, [], { sprintId: 7, startDate: '2026-08-21', endDate: '2026-08-21' });
  assert.equal(sprintAndDates.totalIssues, 1);
});

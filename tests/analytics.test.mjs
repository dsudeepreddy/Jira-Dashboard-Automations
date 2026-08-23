import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isoWeekKey,
  aggregateDashboardMetrics,
  categoryForStatus,
  deriveFlowTimestamps,
} = require('./.tmp/analytics.js');

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

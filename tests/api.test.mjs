import assert from 'node:assert/strict';
import test from 'node:test';

const backend = process.env.BACKEND_TEST_URL || 'http://localhost:5001/api/v1';
const frontend = process.env.FRONTEND_TEST_URL || 'http://localhost:3000';

test('backend health reports a running API', async () => {
  const response = await fetch(`${backend}/health`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.service, 'backend-api');
});

test('backend metrics returns a Jira-backed dashboard contract without an issue dump', async () => {
  const response = await fetch(`${backend}/metrics`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.meta.source, 'jira');
  assert.equal(typeof payload.metrics.totalIssues, 'number');
  assert.equal(payload.metrics.totalIssues, payload.meta.issueCount);
  assert.equal(payload.issues, undefined);
  assert.ok(Array.isArray(payload.metrics.statusBreakdown));
  assert.ok(Array.isArray(payload.metrics.wipAging));
  assert.ok(payload.metrics.forecast);
  assert.ok(payload.metrics.fieldMetrics);
  assert.ok(Array.isArray(payload.metrics.fieldMetrics.labels));
  assert.ok(payload.metrics.velocityUnit === 'points' || payload.metrics.velocityUnit === 'issues');
});

test('backend issues endpoint is paginated', async () => {
  const response = await fetch(`${backend}/issues?page=1&pageSize=25`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.issues));
  assert.ok(payload.issues.length <= 25);
  assert.equal(typeof payload.total, 'number');
});

test('frontend proxy forwards the Jira-backed contract', async () => {
  const response = await fetch(`${frontend}/api/jira`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.meta.source, 'jira');
  assert.equal(payload.metrics.totalIssues, payload.meta.issueCount);
  assert.equal(payload.issues, undefined);
});

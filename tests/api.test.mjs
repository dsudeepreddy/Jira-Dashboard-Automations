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

test('backend metrics returns a Jira-backed dashboard contract', async () => {
  const response = await fetch(`${backend}/metrics`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.meta.source, 'jira');
  assert.equal(payload.meta.issueCount, payload.issues.length);
  assert.equal(payload.metrics.totalIssues, payload.issues.length);
  assert.ok(Array.isArray(payload.metrics.statusBreakdown));
});

test('frontend proxy forwards the Jira-backed contract', async () => {
  const response = await fetch(`${frontend}/api/jira`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.meta.source, 'jira');
  assert.equal(payload.metrics.totalIssues, payload.issues.length);
});
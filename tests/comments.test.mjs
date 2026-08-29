import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { adfToPlainText, isHumanJiraAuthor, latestHumanComment } = require('./.tmp/comments.js');

test('adfToPlainText flattens Jira document nodes', () => {
  const text = adfToPlainText({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Need SOX evidence' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'by Friday.' }] },
    ],
  });
  assert.match(text, /Need SOX evidence/);
  assert.match(text, /by Friday/);
});

test('latestHumanComment skips bots and returns the newest human update', () => {
  const latest = latestHumanComment([
    {
      author: { displayName: 'Automation for Jira', accountType: 'app' },
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Transitioned' }] }] },
      created: '2026-02-02T00:00:00.000Z',
      updated: '2026-02-02T00:00:00.000Z',
    },
    {
      author: { displayName: 'Ada Lovelace', accountType: 'atlassian' },
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Evidence attached' }] }] },
      created: '2026-02-01T00:00:00.000Z',
      updated: '2026-02-03T00:00:00.000Z',
    },
    {
      author: { displayName: 'Ada Lovelace', accountType: 'atlassian' },
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Older note' }] }] },
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
    },
  ]);
  assert.equal(isHumanJiraAuthor({ displayName: 'Automation for Jira', accountType: 'app' }), false);
  assert.equal(latest?.text, 'Evidence attached');
  assert.equal(latest?.author, 'Ada Lovelace');
  assert.equal(latest?.updated, '2026-02-03T00:00:00.000Z');
});

export interface JiraCommentAuthor {
  accountType?: string;
  displayName?: string;
  emailAddress?: string;
}

export interface JiraComment {
  author?: JiraCommentAuthor | null;
  body?: unknown;
  created?: string;
  updated?: string;
}

export interface LatestHumanComment {
  text: string;
  author: string;
  updated: string;
}

export function adfToPlainText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToPlainText).join('');
  if (typeof node !== 'object') return '';
  const record = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof record.text === 'string') return record.text;
  const inner = (record.content || []).map(adfToPlainText).join(record.type === 'paragraph' ? ' ' : '');
  if (record.type === 'hardBreak' || record.type === 'paragraph') return `${inner} `;
  return inner;
}

export function commentBodyToText(body: unknown): string {
  return adfToPlainText(body).replace(/\s+/g, ' ').trim();
}

export function isHumanJiraAuthor(author?: JiraCommentAuthor | null): boolean {
  if (!author) return false;
  const accountType = (author.accountType || 'atlassian').toLowerCase();
  if (accountType && accountType !== 'atlassian') return false;
  const name = (author.displayName || '').toLowerCase();
  if (/\b(bot|automation|script.?runner|github|gitlab|jenkins|service account|noreply)\b/.test(name)) return false;
  if (/\[bot\]/.test(name)) return false;
  const email = (author.emailAddress || '').toLowerCase();
  if (email && /(noreply|bot@|automation@)/.test(email)) return false;
  return Boolean(author.displayName || author.emailAddress);
}

export function latestHumanComment(comments: JiraComment[]): LatestHumanComment | null {
  const humans = comments
    .filter((comment) => isHumanJiraAuthor(comment.author))
    .map((comment) => ({
      text: commentBodyToText(comment.body),
      author: comment.author?.displayName || 'Unknown',
      updated: comment.updated || comment.created || '',
    }))
    .filter((comment) => comment.text && comment.updated);

  humans.sort((left, right) => right.updated.localeCompare(left.updated));
  return humans[0] || null;
}

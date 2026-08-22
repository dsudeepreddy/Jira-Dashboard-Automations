/**
 * Jira REST access lives in the Express backend (`backend/src/services/jiraClient.ts`).
 * The Next.js app only proxies `/api/jira` to that service so tokens never reach the browser.
 */
export function getJiraConfig() {
  throw new Error('Jira credentials are read by the backend API, not the Next.js server.');
}

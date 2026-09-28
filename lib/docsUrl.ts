/** Resolve documentation / repo URL from env (server or build-time public vars). */
export function resolveDocsUrl(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    env.NEXT_PUBLIC_GITLAB_URL,
    env.NEXT_PUBLIC_GITHUB_URL,
    env.NEXT_PUBLIC_DOCS_URL,
    env.GITLAB_URL,
    env.GITHUB_URL,
    env.DOCS_URL,
  ];
  for (const value of candidates) {
    const trimmed = (value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

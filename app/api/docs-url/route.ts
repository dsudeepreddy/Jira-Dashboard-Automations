import { NextResponse } from 'next/server';
import { resolveDocsUrl } from '@/lib/docsUrl';

/** Runtime docs URL so Docker/env_file works without rebuilding NEXT_PUBLIC_ into the client bundle. */
export async function GET() {
  return NextResponse.json({ docsUrl: resolveDocsUrl() });
}

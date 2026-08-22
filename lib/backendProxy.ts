import { NextRequest, NextResponse } from 'next/server';

export function backendHeaders() {
  const token = process.env.BACKEND_API_TOKEN || process.env.SYNC_API_TOKEN;
  return token ? { 'x-api-token': token } : undefined;
}

export function backendUrl() {
  return (process.env.BACKEND_API_URL || 'http://localhost:5001/api/v1').replace(/\/+$/, '');
}

export async function proxyBackendGet(request: NextRequest, path: string) {
  try {
    const { searchParams } = new URL(request.url);
    const response = await fetch(`${backendUrl()}/${path}?${searchParams.toString()}`, {
      cache: 'no-store',
      headers: backendHeaders(),
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Jira API error';
    return NextResponse.json(
      { error: 'Unable to reach the Jira analytics backend.', details: message },
      { status: 502 },
    );
  }
}

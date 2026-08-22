import { NextRequest, NextResponse } from 'next/server';
import type { DashboardPayload } from '@/shared/dashboardContract';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const backendUrl = (process.env.BACKEND_API_URL || 'http://localhost:5001/api/v1').replace(/\/+$/, '');
    const response = await fetch(`${backendUrl}/metrics?${searchParams.toString()}`, {
      cache: 'no-store',
    });
    const payload = (await response.json()) as DashboardPayload | { detail?: string; code?: string };
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Jira API error';
    return NextResponse.json(
      {
        error: 'Unable to reach the Jira analytics backend.',
        details: message,
      },
      { status: 502 },
    );
  }
}

import { NextRequest } from 'next/server';
import { proxyBackendGet } from '@/lib/backendProxy';

export async function GET(request: NextRequest) {
  return proxyBackendGet(request, 'issues');
}

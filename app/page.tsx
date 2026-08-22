import { Suspense } from 'react';
import { AmbientBackground } from '@/components/AmbientBackground';
import { DashboardLayout } from '@/components/DashboardLayout';

export default function HomePage() {
  return (
    <Suspense fallback={(
      <main className="relative isolate min-h-screen">
        <AmbientBackground />
        <p className="relative z-10 px-6 py-10 text-sm text-slate-500">Loading dashboard…</p>
      </main>
    )}>
      <DashboardLayout />
    </Suspense>
  );
}

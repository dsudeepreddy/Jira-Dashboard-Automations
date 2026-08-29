'use client';

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-lg font-semibold">The dashboard hit a runtime error.</p>
      <p className="max-w-md text-sm text-slate-500">Reload, or go back to the home view. If this keeps happening, restart the Next.js app so it picks up the latest code.</p>
      <div className="flex gap-3">
        <button type="button" onClick={() => reset()} className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
        <a href="/" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium">
          Home
        </a>
      </div>
    </main>
  );
}

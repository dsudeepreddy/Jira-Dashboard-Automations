'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Noticeable expand/collapse control with a gentle hop when collapsed. */
export function ExpandHint({
  expanded,
  label = 'Expand',
  collapseLabel = 'Collapse',
  className,
}: {
  expanded: boolean;
  label?: string;
  collapseLabel?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition',
        expanded
          ? 'border-slate-200/80 bg-white/70 text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-slate-300'
          : 'expand-hop border-cyan-400/50 bg-cyan-500 text-white shadow-md shadow-cyan-500/30 dark:border-cyan-300/40 dark:bg-cyan-400 dark:text-slate-950',
        className,
      )}
    >
      <span>{expanded ? collapseLabel : label}</span>
      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
    </span>
  );
}

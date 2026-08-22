'use client';

import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function GlassCard({
  children,
  className,
  spotlight = true,
}: {
  children: ReactNode;
  className?: string;
  spotlight?: boolean;
}) {
  function handleMove(event: MouseEvent<HTMLDivElement>) {
    if (!spotlight) return;
    const node = event.currentTarget;
    const rect = node.getBoundingClientRect();
    node.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    node.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }

  return (
    <div onMouseMove={handleMove} className={cn('glass-card', !spotlight && '[&::before]:hidden', className)}>
      <div className="glass-body h-full">{children}</div>
    </div>
  );
}

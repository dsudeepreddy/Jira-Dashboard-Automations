'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

type MetricCardProps = {
  title: string;
  value: number;
  suffix?: string;
  icon: LucideIcon;
  tone: 'cyan' | 'mint' | 'violet' | 'amber';
  decimals?: number;
  delay?: number;
};

const tones = {
  cyan: { icon: 'bg-cyan-400/15 text-cyan-500 shadow-[0_0_28px_rgba(34,211,238,0.22)]', line: 'bg-cyan-400' },
  mint: { icon: 'bg-emerald-400/15 text-emerald-500 shadow-[0_0_28px_rgba(52,211,153,0.22)]', line: 'bg-emerald-400' },
  violet: { icon: 'bg-violet-400/15 text-violet-500 shadow-[0_0_28px_rgba(167,139,250,0.22)]', line: 'bg-violet-400' },
  amber: { icon: 'bg-amber-400/15 text-amber-500 shadow-[0_0_28px_rgba(251,191,36,0.22)]', line: 'bg-amber-400' },
};

function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const duration = 850;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      setDisplayValue(value * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{displayValue.toFixed(decimals)}</>;
}

export function MetricCard({ title, value, suffix, icon: Icon, tone, decimals = 0, delay = 0 }: MetricCardProps) {
  const palette = tones[tone];
  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className="glass-card relative overflow-hidden p-5"
    >
      <div className={`absolute inset-x-0 top-0 h-px ${palette.line} opacity-70`} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{title}</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
              <AnimatedNumber value={value} decimals={decimals} />
            </span>
            {suffix ? <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{suffix}</span> : null}
          </div>
        </div>
        <div className={`rounded-2xl p-3 ${palette.icon}`}><Icon className="h-5 w-5" /></div>
      </div>
    </motion.article>
  );
}

'use client';

import { motion } from 'framer-motion';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

type StatusDatum = { name: string; value: number; color: string };

function GlassTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }> }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-white/20 bg-slate-950/85 px-3 py-2 text-xs text-white shadow-xl backdrop-blur-xl"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: payload[0].color }} />{payload[0].name}: <strong>{payload[0].value}</strong></div>;
}

export function StatusDistributionChart({ data }: { data: StatusDatum[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.2 }} className="glass-card p-5">
      <div className="mb-2 flex items-center justify-between"><div><p className="eyebrow">Portfolio health</p><h2 className="section-title">Status distribution</h2></div><span className="status-chip">{total} issues</span></div>
      <div className="relative h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>{data.map((entry, index) => <linearGradient key={entry.name} id={`status-${index}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={entry.color} stopOpacity={1} /><stop offset="100%" stopColor={entry.color} stopOpacity={0.42} /></linearGradient>)}</defs>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={72} outerRadius={102} paddingAngle={4} stroke="none" animationDuration={900}>
              {data.map((entry, index) => <Cell key={entry.name} fill={`url(#status-${index})`} />)}
            </Pie>
            <Tooltip content={<GlassTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="font-display text-4xl font-semibold text-slate-950 dark:text-white">{total}</span><span className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">tracked</span></div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-slate-200/70 pt-4 dark:border-slate-700/70">{data.map((entry) => <div key={entry.name} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color, boxShadow: `0 0 10px ${entry.color}` }} />{entry.name}<strong className="ml-auto text-slate-900 dark:text-white">{entry.value}</strong></div>)}</div>
    </motion.section>
  );
}

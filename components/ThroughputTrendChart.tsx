'use client';

import { motion } from 'framer-motion';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type ThroughputDatum = { period: string; created: number; resolved: number };

function GlassTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-white/20 bg-slate-950/85 px-3 py-2 text-xs text-white shadow-xl backdrop-blur-xl"><p className="mb-1 text-slate-400">{label}</p>{payload.map((item) => <p key={item.name}><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: item.color }} />{item.name}: <strong>{item.value}</strong></p>)}</div>;
}

export function ThroughputTrendChart({ data }: { data: ThroughputDatum[] }) {
  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.28 }} className="glass-card p-5">
      <div className="mb-5"><p className="eyebrow">Delivery rhythm</p><h2 className="section-title">Throughput trend</h2></div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={6} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <defs><linearGradient id="created-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#2563eb" /></linearGradient><linearGradient id="resolved-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" /><stop offset="100%" stopColor="#7c3aed" /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-300/50 dark:text-slate-700/50" />
            <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip content={<GlassTooltip />} />
            <Bar dataKey="created" name="Created" fill="url(#created-bar)" radius={[6, 6, 0, 0]} animationDuration={1200} />
            <Bar dataKey="resolved" name="Resolved" fill="url(#resolved-bar)" radius={[6, 6, 0, 0]} animationDuration={1200} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
}

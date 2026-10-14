'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SkyTooltip } from '@/components/charts/sky-chart';

export function ParameterTrendChart({
  title, data, empty,
}: {
  title: string;
  data: Array<{ month: string; value: number }>;
  empty?: boolean;
}) {
  if (empty || !data.length) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">{title}: No data</div>;
  }
  return (
    <div className="h-40">
      <p className="text-xs font-medium mb-2">{title}</p>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="pqr-param-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity={0.32} />
              <stop offset="100%" stopColor="#2563EB" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} width={36} axisLine={false} tickLine={false} />
          <Tooltip content={<SkyTooltip />} />
          <Area type="monotone" dataKey="value" name={title} stroke="#2563EB" strokeWidth={2.5} fill="url(#pqr-param-area)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

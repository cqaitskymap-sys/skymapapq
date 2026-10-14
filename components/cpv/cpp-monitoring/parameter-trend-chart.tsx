'use client';

import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { SkyTooltip } from '@/components/charts/sky-chart';

export function ParameterTrendChart({
  data,
  title,
}: {
  data: Array<{ label: string; observed: number; target?: number; lsl?: number; usl?: number }>;
  title?: string;
}) {
  if (!data.length) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
        No trend data for selected parameter
      </div>
    );
  }
  const lsl = data[0]?.lsl;
  const usl = data[0]?.usl;
  return (
    <div className="h-[300px] w-full">
      {title && <p className="mb-2 text-sm font-medium">{title}</p>}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <defs>
            <linearGradient id="cpp-observed-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#2563EB" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="4 8" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis domain={['auto', 'auto']} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<SkyTooltip />} />
          <Legend />
          {lsl != null && <ReferenceLine y={lsl} stroke="#F43F5E" strokeDasharray="4 4" label="LSL" />}
          {usl != null && <ReferenceLine y={usl} stroke="#F43F5E" strokeDasharray="4 4" label="USL" />}
          <Area type="monotone" dataKey="observed" name="Observed" stroke="#2563EB" strokeWidth={2.5} fill="url(#cpp-observed-area)" dot={{ r: 3, strokeWidth: 2, fill: '#fff', stroke: '#2563EB' }} />
          {data.some((d) => d.target != null) && (
            <Line type="monotone" dataKey="target" name="Target" stroke="#14B8A6" strokeDasharray="5 5" strokeWidth={2} dot={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

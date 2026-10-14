'use client';

import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { SkyTooltip } from '@/components/charts/sky-chart';

export function YieldTrendChart({
  data,
  title,
}: {
  data: Array<{ label: string; yield: number; target?: number; lower?: number; upper?: number }>;
  title?: string;
}) {
  if (!data.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No yield trend data
      </div>
    );
  }
  const lower = data[0]?.lower;
  const upper = data[0]?.upper;
  return (
    <div className="h-[220px] w-full">
      {title && <p className="mb-2 text-sm font-medium">{title}</p>}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <defs>
            <linearGradient id="yield-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity={0.32} />
              <stop offset="100%" stopColor="#2563EB" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="4 8" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<SkyTooltip />} />
          <Legend />
          {lower != null && <ReferenceLine y={lower} stroke="#F43F5E" strokeDasharray="4 4" label="LSL" />}
          {upper != null && <ReferenceLine y={upper} stroke="#F43F5E" strokeDasharray="4 4" label="USL" />}
          <Area type="monotone" dataKey="yield" name="Yield %" stroke="#2563EB" strokeWidth={2.5} fill="url(#yield-area)" dot={{ r: 3, strokeWidth: 2, fill: '#fff', stroke: '#2563EB' }} />
          {data.some((d) => d.target != null) && (
            <Line type="monotone" dataKey="target" name="Target" stroke="#14B8A6" strokeDasharray="5 5" strokeWidth={2} dot={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

'use client';

import {
  CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { TrendChartPoint } from '@/lib/cpv-trend-records';

function TrendDot(props: { cx?: number; cy?: number; payload?: TrendChartPoint }) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload) return null;
  let fill = '#2563eb';
  let r = 3;
  if (payload.isOOS) { fill = '#dc2626'; r = 5; }
  else if (payload.isAction) { fill = '#ea580c'; r = 4; }
  else if (payload.isOOT) { fill = '#d97706'; r = 4; }
  else if (payload.isAlert) { fill = '#f59e0b'; r = 4; }
  return <circle cx={cx} cy={cy} r={r} fill={fill} stroke="#fff" strokeWidth={1} />;
}

export function ParameterTrendChart({
  data,
  title,
  height = 320,
  ucl,
  lcl,
}: {
  data: TrendChartPoint[];
  title?: string;
  height?: number;
  ucl?: number;
  lcl?: number;
}) {
  if (!data.length) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
        No trend data for selected parameter
      </div>
    );
  }

  const lsl = data.find((d) => Number.isFinite(d.lsl))?.lsl;
  const usl = data.find((d) => Number.isFinite(d.usl))?.usl;
  const target = data.find((d) => Number.isFinite(d.target))?.target;
  const mean = data[0]?.mean;

  return (
    <div className="w-full" style={{ height }}>
      {title && <p className="mb-2 text-sm font-medium">{title}</p>}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-25} textAnchor="end" height={50} />
          <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(value: number, name: string) => [value, name]}
            labelFormatter={(label) => `Batch: ${label}`}
          />
          <Legend verticalAlign="top" height={28} />
          {lsl != null && <ReferenceLine y={lsl} stroke="#dc2626" strokeDasharray="6 4" label={{ value: 'LSL', fontSize: 10 }} />}
          {usl != null && <ReferenceLine y={usl} stroke="#dc2626" strokeDasharray="6 4" label={{ value: 'USL', fontSize: 10 }} />}
          {target != null && <ReferenceLine y={target} stroke="#059669" strokeDasharray="4 4" label={{ value: 'Target', fontSize: 10 }} />}
          {mean != null && <ReferenceLine y={mean} stroke="#7c3aed" strokeDasharray="4 4" label={{ value: 'Mean', fontSize: 10 }} />}
          {Number.isFinite(ucl) && <ReferenceLine y={ucl} stroke="#9333ea" strokeDasharray="2 4" label={{ value: 'UCL', fontSize: 10 }} />}
          {Number.isFinite(lcl) && <ReferenceLine y={lcl} stroke="#9333ea" strokeDasharray="2 4" label={{ value: 'LCL', fontSize: 10 }} />}
          <Line
            type="monotone"
            dataKey="value"
            name="Observed Value"
            stroke="#2563eb"
            strokeWidth={2}
            dot={<TrendDot />}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {data.some((d) => d.isOOS) && <span className="text-red-700">● OOS</span>}
        {data.some((d) => d.isOOT) && <span className="text-amber-700">● OOT</span>}
        {data.some((d) => d.isAlert) && <span className="text-amber-600">● Alert</span>}
        {data.some((d) => d.isAction) && <span className="text-orange-700">● Action</span>}
      </div>
    </div>
  );
}

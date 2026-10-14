'use client';

import { useId } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const CHART_PALETTE = [
  '#2563EB',
  '#0EA5E9',
  '#14B8A6',
  '#8B5CF6',
  '#F59E0B',
  '#F43F5E',
  '#22C55E',
  '#6366F1',
];

type ChartRow = {
  name?: string | number;
  value?: string | number;
  month?: string | number;
  [key: string]: string | number | undefined;
};

type TipItem = {
  name?: string | number;
  value?: string | number;
  color?: string;
  dataKey?: string | number;
};

export function SkyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TipItem[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[140px] rounded-2xl border border-white/70 bg-white/90 px-3 py-2 shadow-[0_16px_40px_-18px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/90">
      {label != null && label !== '' && (
        <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-foreground">{label}</p>
      )}
      <ul className="space-y-1">
        {payload.map((item, index) => (
          <li key={`${item.dataKey ?? item.name ?? index}`} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color || CHART_PALETTE[0] }} />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums text-foreground">{item.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function axisTick() {
  return { fontSize: 11, fill: 'currentColor' };
}

function seriesLabel(key: string) {
  const labels: Record<string, string> = {
    value: 'Value',
    count: 'Count',
    pct: 'Percent',
    days: 'Days',
  };
  return labels[key] || key;
}

export function SkyPlot({
  data,
  type,
  dataKey,
  xKey,
  lineKey,
  multi = false,
  height = 210,
}: {
  data: readonly object[];
  type: 'pie' | 'bar' | 'line';
  dataKey?: string;
  xKey?: string;
  lineKey?: string;
  multi?: boolean;
  height?: number;
}) {
  const rows = data as ChartRow[];
  const rawId = useId().replace(/:/g, '');
  const areaId = `sky-area-${rawId}`;
  const barId = `sky-bar-${rawId}`;
  const seriesKey = dataKey || lineKey || (type === 'line' ? 'count' : 'value');
  const categoryKey = xKey || (type === 'line' || multi || lineKey ? 'month' : 'name');

  if (type === 'pie') {
    return (
      <div>
        <div style={{ height: Math.max(150, height - 36) }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={rows}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="58%"
                outerRadius="82%"
                paddingAngle={3}
                stroke="transparent"
              >
                {rows.map((_, index) => (
                  <Cell key={index} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip content={<SkyTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 px-1">
          {rows.map((row, index) => (
            <span key={`${row.name ?? index}`} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: CHART_PALETTE[index % CHART_PALETTE.length] }}
              />
              <span className="max-w-[120px] truncate">{row.name}</span>
              <span className="font-semibold tabular-nums text-foreground">{row.value}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="text-muted-foreground" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {type === 'line' ? (
          <AreaChart data={rows} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563EB" stopOpacity={0.38} />
                <stop offset="100%" stopColor="#2563EB" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.18} strokeDasharray="4 8" />
            <XAxis dataKey={categoryKey} tick={axisTick()} axisLine={false} tickLine={false} dy={6} />
            <YAxis tick={axisTick()} axisLine={false} tickLine={false} width={36} />
            <Tooltip content={<SkyTooltip />} cursor={{ stroke: '#2563EB', strokeOpacity: 0.25 }} />
            <Area
              type="monotone"
              dataKey={seriesKey}
              name={seriesLabel(seriesKey)}
              stroke="#2563EB"
              strokeWidth={2.5}
              fill={`url(#${areaId})`}
              dot={{ r: 3, strokeWidth: 2, fill: 'var(--sky-dot, #fff)', stroke: '#2563EB' }}
              activeDot={{ r: 5, strokeWidth: 0 }}
            />
          </AreaChart>
        ) : (
          <BarChart data={rows.slice(0, 8)} margin={{ top: 12, right: 8, left: 0, bottom: 4 }} barGap={4}>
            <defs>
              <linearGradient id={barId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38BDF8" />
                <stop offset="100%" stopColor="#2563EB" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.18} strokeDasharray="4 8" />
            <XAxis
              dataKey={multi ? 'month' : categoryKey}
              tick={axisTick()}
              axisLine={false}
              tickLine={false}
              interval={0}
              angle={multi ? 0 : -18}
              textAnchor={multi ? 'middle' : 'end'}
              height={multi ? 28 : 48}
            />
            <YAxis tick={axisTick()} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
            <Tooltip content={<SkyTooltip />} cursor={{ fill: 'rgba(37,99,235,0.08)' }} />
            {multi ? (
              <>
                <Bar dataKey="minor" name="Minor" fill="#2563EB" radius={[7, 7, 2, 2]} maxBarSize={18} />
                <Bar dataKey="major" name="Major" fill="#F43F5E" radius={[7, 7, 2, 2]} maxBarSize={18} />
              </>
            ) : (
              <Bar dataKey={seriesKey} name={seriesLabel(seriesKey)} fill={`url(#${barId})`} radius={[8, 8, 3, 3]} maxBarSize={36} />
            )}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export function MetricChartCard({
  title,
  data,
  type,
  dataKey,
  xKey,
  lineKey,
  multi,
  height = 210,
}: {
  title: string;
  data: readonly object[];
  type: 'pie' | 'bar' | 'line';
  dataKey?: string;
  xKey?: string;
  lineKey?: string;
  multi?: boolean;
  height?: number;
}) {
  return (
    <Card className="overflow-hidden rounded-2xl border-border/60 bg-card/90 shadow-[0_10px_30px_-18px_rgba(37,99,235,0.55)]">
      <div aria-hidden className="h-[3px] bg-gradient-to-r from-[#2563EB] via-sky-400 to-indigo-400" />
      <CardHeader className="space-y-0 px-4 pb-1 pt-3">
        <CardTitle className="text-sm font-semibold tracking-tight">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-4">
        {!data.length ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">No data</div>
        ) : (
          <SkyPlot
            data={data}
            type={type}
            dataKey={dataKey}
            xKey={xKey}
            lineKey={lineKey}
            multi={multi}
            height={height}
          />
        )}
      </CardContent>
    </Card>
  );
}

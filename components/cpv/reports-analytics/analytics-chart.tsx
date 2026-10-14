'use client';

import { SkyPlot } from '@/components/charts/sky-chart';

export function AnalyticsChart({
  title,
  data,
  type = 'bar',
}: {
  title: string;
  data: Array<{ name: string; value?: number; compliance?: number }>;
  type?: 'bar' | 'pie';
  colors?: string[];
}) {
  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
        No chart data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: d.name,
    value: d.value ?? d.compliance ?? 0,
  }));

  return (
    <div>
      <p className="mb-2 text-sm font-semibold tracking-tight">{title}</p>
      <SkyPlot data={chartData} type={type} dataKey="value" xKey="name" height={190} />
    </div>
  );
}

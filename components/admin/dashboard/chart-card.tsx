'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricChartCard } from '@/components/charts/sky-chart';
import { EmptyState } from './empty-state';

interface DashboardChartCardProps {
  title: string;
  data: Array<{ name: string; value: number }>;
  type: 'pie' | 'bar' | 'line';
}

export function DashboardChartCard({ title, data, type }: DashboardChartCardProps) {
  const isEmpty = data.length === 1 && data[0].name === 'No Data' && data[0].value === 0;

  if (!isEmpty) {
    return <MetricChartCard title={title} data={data} type={type} dataKey="value" xKey="name" />;
  }

  return (
    <Card className="overflow-hidden rounded-2xl border-border/60 shadow-[0_10px_30px_-18px_rgba(37,99,235,0.55)]">
      <div aria-hidden className="h-[3px] bg-gradient-to-r from-[#2563EB] via-sky-400 to-indigo-400" />
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold tracking-tight">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <EmptyState message="Chart data will appear when records exist." />
      </CardContent>
    </Card>
  );
}

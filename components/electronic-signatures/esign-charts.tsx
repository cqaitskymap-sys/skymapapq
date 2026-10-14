'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { SignatureCharts } from '@/lib/electronic-signatures-types';


export function EsignCharts({ charts }: { charts: SignatureCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Daily Signature Trend" data={charts.dailyTrend} type="line" dataKey="count" xKey="date" />
      <Chart title="Module-wise Signatures" data={charts.moduleWise} type="bar" />
      <Chart title="Signature Meaning Distribution" data={charts.meaningDistribution} type="pie" />
      <Chart title="Failed Authentication Trend" data={charts.failedAuthTrend} type="line" dataKey="count" xKey="date" />
      <Chart title="User Signature Activity" data={charts.userActivity} type="bar" />
    </div>
  );
}

'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { EffectiveDateCharts } from '@/lib/effective-date-types';


export function EdmCharts({ charts }: { charts: EffectiveDateCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Activation Trend" data={charts.activationTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Department Activations" data={charts.departmentActivations} type="bar" />
      <Chart title="Document Type Distribution" data={charts.documentTypeDistribution} type="pie" />
      <Chart title="Training Dependency Trend" data={charts.trainingDependencyTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Rollback Trend" data={charts.rollbackTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Activation Success Rate" data={charts.activationSuccessRate} type="line" dataKey="pct" xKey="month" />
    </div>
  );
}

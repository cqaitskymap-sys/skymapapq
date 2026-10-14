'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { FormCharts } from '@/lib/forms-templates-types';


export function FormsCharts({ charts }: { charts: FormCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Chart title="Status Distribution" data={charts.statusDistribution} type="pie" />
      <Chart title="Category Distribution" data={charts.categoryDistribution} type="bar" />
      <Chart title="Department Distribution" data={charts.departmentDistribution} type="bar" />
      <Chart title="Review Due Trend" data={charts.reviewDueTrend} type="line" lineKey="count" />
      <Chart title="Version Trend" data={charts.versionTrend} type="bar" lineKey="count" />
      <Chart title="Revision Trend" data={charts.revisionTrend} type="bar" lineKey="count" />
      <Chart title="Training Completion Trend" data={charts.trainingCompletionTrend} type="line" lineKey="pct" />
    </div>
  );
}

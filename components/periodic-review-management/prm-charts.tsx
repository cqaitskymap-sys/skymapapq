'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { PeriodicReviewCharts } from '@/lib/periodic-review-types';


export function PrmCharts({ charts }: { charts: PeriodicReviewCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Review Status Distribution" data={charts.statusDistribution} type="pie" />
      <Chart title="Review Frequency Distribution" data={charts.frequencyDistribution} type="pie" />
      <Chart title="Department Review Trend" data={charts.departmentTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Overdue Trend" data={charts.overdueTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Review Decision Trend" data={charts.decisionTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Revision Trend" data={charts.revisionTrend} type="bar" dataKey="minor" xKey="month" multi />
    </div>
  );
}

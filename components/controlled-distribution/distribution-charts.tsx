'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { DistributionCharts } from '@/lib/controlled-distribution-types';


export function DistributionCharts({ charts }: { charts: DistributionCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Distribution Trend" data={charts.distributionTrend} type="line" dataKey="count" />
      <Chart title="Department Distribution" data={charts.departmentDistribution} type="bar" />
      <Chart title="Document Type Distribution" data={charts.documentTypeDistribution} type="bar" />
      <Chart title="Acknowledgement Status" data={charts.acknowledgementStatus} type="pie" />
      <Chart title="Training Assignment Trend" data={charts.trainingAssignmentTrend} type="line" dataKey="count" />
      <Chart title="Site Distribution" data={charts.siteDistribution} type="bar" />
    </div>
  );
}

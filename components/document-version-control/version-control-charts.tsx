'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { VersionControlCharts } from '@/lib/document-version-control-types';


export function VersionControlCharts({ charts }: { charts: VersionControlCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Version Growth Trend" data={charts.versionGrowthTrend} type="line" dataKey="count" />
      <Chart title="Revision Type Distribution" data={charts.revisionTypeDistribution} type="pie" />
      <Chart title="Document Type Distribution" data={charts.documentTypeDistribution} type="bar" />
      <Chart title="Department Distribution" data={charts.departmentDistribution} type="bar" />
      <Chart title="Approval Timeline" data={charts.approvalTimeline} type="line" dataKey="count" />
      <Chart title="Superseded Trend" data={charts.supersededTrend} type="line" dataKey="count" />
    </div>
  );
}

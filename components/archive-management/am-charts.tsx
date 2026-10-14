'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { ArchiveCharts } from '@/lib/archive-management-types';


export function AmCharts({ charts }: { charts: ArchiveCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Archive Trend" data={charts.archiveTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Document Type Distribution" data={charts.documentTypeDistribution} type="pie" />
      <Chart title="Archive Category Distribution" data={charts.archiveCategoryDistribution} type="pie" />
      <Chart title="Department Archive Trend" data={charts.departmentArchiveTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Retention Expiry Trend" data={charts.retentionExpiryTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Restoration Trend" data={charts.restorationTrend} type="line" dataKey="count" xKey="month" />
    </div>
  );
}

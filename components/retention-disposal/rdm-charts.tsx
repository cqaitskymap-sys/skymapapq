'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { RetentionDisposalCharts } from '@/lib/retention-disposal-types';


export function RdmCharts({ charts }: { charts: RetentionDisposalCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Retention Expiry Trend" data={charts.retentionExpiryTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Retention by Document Type" data={charts.retentionByDocumentType} type="pie" />
      <Chart title="Department Retention Distribution" data={charts.departmentRetentionDistribution} type="bar" />
      <Chart title="Disposal Trend" data={charts.disposalTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Legal Hold Trend" data={charts.legalHoldTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Regulatory Hold Trend" data={charts.regulatoryHoldTrend} type="line" dataKey="count" xKey="month" />
    </div>
  );
}

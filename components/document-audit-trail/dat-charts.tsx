'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { DocumentAuditCharts } from '@/lib/document-audit-trail-types';


export function DatCharts({ charts }: { charts: DocumentAuditCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Daily Audit Activity" data={charts.dailyActivity} type="line" dataKey="count" xKey="date" />
      <Chart title="Event Type Distribution" data={charts.eventTypeDistribution} type="pie" />
      <Chart title="Module Activity" data={charts.moduleActivity} type="bar" />
      <Chart title="User Activity" data={charts.userActivity} type="bar" />
      <Chart title="Department Activity" data={charts.departmentActivity} type="bar" />
      <Chart title="Security Event Trend" data={charts.securityEventTrend} type="line" dataKey="count" xKey="date" />
    </div>
  );
}

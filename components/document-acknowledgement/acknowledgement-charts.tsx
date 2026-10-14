'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { AcknowledgementCharts } from '@/lib/document-acknowledgement-types';


export function AcknowledgementCharts({ charts }: { charts: AcknowledgementCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Acknowledgement Trend" data={charts.acknowledgementTrend} type="line" dataKey="count" />
      <Chart title="Completion Rate" data={charts.completionRate} type="pie" />
      <Chart title="Department Completion" data={charts.departmentCompletion} type="bar" dataKey="pct" />
      <Chart title="Overdue Trend" data={charts.overdueTrend} type="line" dataKey="count" />
      <Chart title="Document Type Distribution" data={charts.documentTypeDistribution} type="bar" />
      <Chart title="Training Assignment Trend" data={charts.trainingAssignmentTrend} type="line" dataKey="count" />
    </div>
  );
}

'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { ReviewCharts } from '@/lib/document-review-types';


export function ReviewCharts({ charts }: { charts: ReviewCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Review Status Distribution" data={charts.statusDistribution} type="pie" />
      <Chart title="Completion Trend" data={charts.completionTrend} type="line" dataKey="count" />
      <Chart title="Average Review Time (days)" data={charts.averageReviewTime} type="line" dataKey="days" />
      <Chart title="Department Review Load" data={charts.departmentLoad} type="bar" />
      <Chart title="Reviewer Workload" data={charts.reviewerWorkload} type="bar" />
      <Chart title="SLA Compliance Trend" data={charts.slaComplianceTrend} type="line" dataKey="pct" />
    </div>
  );
}

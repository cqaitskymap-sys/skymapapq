'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { ChangeImpactCharts } from '@/lib/change-impact-assessment-types';


export function CiaCharts({ charts }: { charts: ChangeImpactCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Impact Rating Distribution" data={charts.impactRatingDistribution} type="pie" />
      <Chart title="Department Impact" data={charts.departmentImpact} type="bar" />
      <Chart title="Assessment Trend" data={charts.assessmentTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Risk Trend" data={charts.riskTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Validation Impact Trend" data={charts.validationImpactTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Training Impact Trend" data={charts.trainingImpactTrend} type="line" dataKey="count" xKey="month" />
    </div>
  );
}

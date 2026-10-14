'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { ExternalDocumentCharts } from '@/lib/external-document-types';


export function EdmCharts({ charts }: { charts: ExternalDocumentCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Document Type Distribution" data={charts.documentTypeDistribution} type="pie" />
      <Chart title="Review Status" data={charts.reviewStatus} type="pie" />
      <Chart title="Department Distribution" data={charts.departmentDistribution} type="bar" />
      <Chart title="Source Organization" data={charts.sourceOrganizationDistribution} type="bar" />
      <Chart title="Review Trend" data={charts.reviewTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Revision Trend" data={charts.revisionTrend} type="line" dataKey="count" xKey="month" />
    </div>
  );
}

'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { WatermarkCharts } from '@/lib/watermark-types';


export function WmCharts({ charts }: { charts: WatermarkCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Watermark Usage Trend" data={charts.usageTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Document Status Distribution" data={charts.documentStatusDistribution} type="pie" />
      <Chart title="Watermark Type Distribution" data={charts.watermarkTypeDistribution} type="pie" />
      <Chart title="Department Distribution" data={charts.departmentDistribution} type="bar" />
      <Chart title="Print Watermark Trend" data={charts.printWatermarkTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Export Watermark Trend" data={charts.exportWatermarkTrend} type="line" dataKey="count" xKey="month" />
    </div>
  );
}

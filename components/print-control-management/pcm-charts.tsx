'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { PrintControlCharts } from '@/lib/print-control-types';


export function PcmCharts({ charts }: { charts: PrintControlCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Print Trend" data={charts.printTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Document Type Distribution" data={charts.documentTypeDistribution} type="pie" />
      <Chart title="Department Printing" data={charts.departmentPrinting} type="bar" />
      <Chart title="Controlled vs Uncontrolled" data={charts.controlledVsUncontrolled} type="pie" />
      <Chart title="Outstanding Copy Trend" data={charts.outstandingCopyTrend} type="line" dataKey="count" xKey="month" />
      <Chart title="Destruction Trend" data={charts.destructionTrend} type="line" dataKey="count" xKey="month" />
    </div>
  );
}

'use client';

import { MetricChartCard as Chart } from '@/components/charts/sky-chart';

import type { ApprovalCharts } from '@/lib/document-approval-types';


export function ApprovalCharts({ charts }: { charts: ApprovalCharts }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Chart title="Approval Status Distribution" data={charts.statusDistribution} type="pie" />
      <Chart title="Approval Timeline" data={charts.approvalTimeline} type="line" dataKey="count" />
      <Chart title="Department Approvals" data={charts.departmentApprovals} type="bar" />
      <Chart title="Approver Workload" data={charts.approverWorkload} type="bar" />
      <Chart title="Average Approval Duration (days)" data={charts.averageApprovalDuration} type="line" dataKey="days" />
      <Chart title="SLA Compliance Trend" data={charts.slaComplianceTrend} type="line" dataKey="pct" />
      <Chart title="Escalation Trend" data={charts.escalationTrend} type="line" dataKey="count" />
    </div>
  );
}

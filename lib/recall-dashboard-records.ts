import { normalizeRole } from '@/lib/permissions';
import type {
  RecallActivityEntry,
  RecallDashboardChartData,
  RecallDashboardMetrics,
  RecallFilters,
  RecallOpenRecoveryRow,
  RecallRecord,
  RecallRegulatoryPendingRow,
} from '@/lib/recall-types';
import {
  canExportRecallDashboard,
  canViewRecallDashboard,
  getRecallDueDate,
  getRecallRecoveryPercent,
  isMockRecall,
  isRecallCapaLinked,
  isRecallClosed,
  isRecallComplaintLinked,
  isRecallCritical,
  isRecallDashboardReadOnly,
  isRecallOpen,
  isRecallOverdue,
  isRecoveryInProgress,
  isRegulatoryPending,
} from '@/lib/recall-types';

export const RECALL_DASHBOARD_MODULE = 'Product Recall Dashboard';

export type RecallDashboardActor = {
  id: string;
  name: string;
  role?: string;
  department?: string;
};

export const KPI_FILTER_MAP: Record<string, Partial<RecallFilters>> = {
  total: {},
  open: { kpi_filter: 'open' },
  closed: { kpi_filter: 'closed' },
  mock: { kpi_filter: 'mock' },
  class_i: { kpi_filter: 'class_i' },
  class_ii: { kpi_filter: 'class_ii' },
  class_iii: { kpi_filter: 'class_iii' },
  regulatory_pending: { kpi_filter: 'regulatory_pending' },
  recovery_in_progress: { kpi_filter: 'recovery_in_progress' },
  capa_linked: { kpi_filter: 'capa_linked' },
  complaint_linked: { kpi_filter: 'complaint_linked' },
  critical: { kpi_filter: 'critical' },
  overdue: { kpi_filter: 'overdue' },
};

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

function toSorted(m: Map<string, number>) {
  return Array.from(m.entries())
    .map(([name, count]) => ({ name, count, value: count }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
}

function monthKey(date: string): string {
  return date?.slice(0, 7) || 'Unknown';
}

export function applyRecallDashboardFilters(
  records: RecallRecord[],
  filters?: RecallFilters,
): RecallRecord[] {
  let results = [...records];
  const f = filters || {};

  if (f.kpi_filter === 'open') results = results.filter((r) => isRecallOpen(r.recall_status));
  if (f.kpi_filter === 'closed') results = results.filter((r) => r.recall_status === 'closed');
  if (f.kpi_filter === 'mock') results = results.filter(isMockRecall);
  if (f.kpi_filter === 'class_i') results = results.filter((r) => r.recall_classification === 'Class I');
  if (f.kpi_filter === 'class_ii') results = results.filter((r) => r.recall_classification === 'Class II');
  if (f.kpi_filter === 'class_iii') results = results.filter((r) => r.recall_classification === 'Class III');
  if (f.kpi_filter === 'regulatory_pending') results = results.filter(isRegulatoryPending);
  if (f.kpi_filter === 'recovery_in_progress') results = results.filter(isRecoveryInProgress);
  if (f.kpi_filter === 'capa_linked') results = results.filter(isRecallCapaLinked);
  if (f.kpi_filter === 'complaint_linked') results = results.filter(isRecallComplaintLinked);
  if (f.kpi_filter === 'critical') results = results.filter(isRecallCritical);
  if (f.kpi_filter === 'overdue') results = results.filter(isRecallOverdue);

  if (f.recall_status && f.recall_status !== 'all') {
    results = results.filter((r) => r.recall_status === f.recall_status);
  }
  if (f.recall_type && f.recall_type !== 'all') {
    results = results.filter((r) => r.recall_type === f.recall_type);
  }
  if (f.recall_classification && f.recall_classification !== 'all') {
    results = results.filter((r) => r.recall_classification === f.recall_classification);
  }
  if (f.product) {
    const p = f.product.toLowerCase();
    results = results.filter((r) => (r.product_name || '').toLowerCase().includes(p));
  }
  if (f.batch_number) {
    results = results.filter((r) => (r.batch_number || '').includes(f.batch_number!));
  }
  if (f.market_region) {
    const m = f.market_region.toLowerCase();
    results = results.filter((r) => (r.market_region || '').toLowerCase().includes(m));
  }
  if (f.date_from) {
    results = results.filter((r) => r.recall_date >= f.date_from!);
  }
  if (f.date_to) {
    results = results.filter((r) => r.recall_date <= f.date_to!);
  }
  if (f.search) {
    const s = f.search.toLowerCase();
    results = results.filter((r) =>
      (r.recall_number || '').toLowerCase().includes(s)
      || (r.product_name || '').toLowerCase().includes(s)
      || (r.batch_number || '').toLowerCase().includes(s)
      || (r.market_region || '').toLowerCase().includes(s));
  }
  return results;
}

export function filterRecallsByRole(
  records: RecallRecord[],
  role?: string | null,
  userId?: string,
): RecallRecord[] {
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'regulatory_affairs', 'auditor', 'viewer'].includes(r)) {
    return records;
  }
  if (['warehouse', 'warehouse_manager'].includes(r)) {
    return records.filter((rec) =>
      rec.recall_status === 'recovery_in_progress'
      || rec.recall_status === 'in_progress'
      || rec.created_by === userId);
  }
  return records.filter((rec) => rec.created_by === userId);
}

export function computeRecallDashboardMetrics(records: RecallRecord[]): RecallDashboardMetrics {
  const withRecovery = records.filter((r) => (r.distributed_quantity ?? 0) > 0);
  const avgRecoveryPercent = withRecovery.length
    ? Math.round(withRecovery.reduce((s, r) => s + getRecallRecoveryPercent(r), 0) / withRecovery.length)
    : 0;

  return {
    total: records.length,
    open: records.filter((r) => isRecallOpen(r.recall_status)).length,
    closed: records.filter((r) => r.recall_status === 'closed').length,
    mockRecalls: records.filter(isMockRecall).length,
    classI: records.filter((r) => r.recall_classification === 'Class I').length,
    classII: records.filter((r) => r.recall_classification === 'Class II').length,
    classIII: records.filter((r) => r.recall_classification === 'Class III').length,
    regulatoryPending: records.filter(isRegulatoryPending).length,
    recoveryInProgress: records.filter(isRecoveryInProgress).length,
    avgRecoveryPercent,
    capaLinked: records.filter(isRecallCapaLinked).length,
    complaintLinked: records.filter(isRecallComplaintLinked).length,
    critical: records.filter(isRecallCritical).length,
    overdue: records.filter(isRecallOverdue).length,
  };
}

export function computeRecallChartData(records: RecallRecord[]): RecallDashboardChartData {
  const byMonth = new Map<string, number>();
  const byClassification = new Map<string, number>();
  const byProduct = new Map<string, number>();
  const byMarket = new Map<string, number>();
  const recoveryByMonth = new Map<string, { sum: number; count: number }>();
  const complaintByMonth = new Map<string, number>();
  const capaByMonth = new Map<string, number>();
  let openCount = 0;
  let closedCount = 0;

  for (const r of records) {
    const month = monthKey(r.recall_date);
    byMonth.set(month, (byMonth.get(month) || 0) + 1);
    byClassification.set(r.recall_classification || 'Unknown', (byClassification.get(r.recall_classification || 'Unknown') || 0) + 1);
    byProduct.set(r.product_name || 'Unknown', (byProduct.get(r.product_name || 'Unknown') || 0) + 1);
    byMarket.set(r.market_region || 'Unknown', (byMarket.get(r.market_region || 'Unknown') || 0) + 1);

    if (isRecallOpen(r.recall_status)) openCount += 1;
    else if (isRecallClosed(r.recall_status) || r.recall_status === 'completed') closedCount += 1;

    if ((r.distributed_quantity ?? 0) > 0) {
      const cur = recoveryByMonth.get(month) || { sum: 0, count: 0 };
      cur.sum += getRecallRecoveryPercent(r);
      cur.count += 1;
      recoveryByMonth.set(month, cur);
    }
    if (isRecallComplaintLinked(r)) {
      complaintByMonth.set(month, (complaintByMonth.get(month) || 0) + 1);
    }
    if (isRecallCapaLinked(r)) {
      capaByMonth.set(month, (capaByMonth.get(month) || 0) + 1);
    }
  }

  const recoveryTrend = Array.from(recoveryByMonth.entries())
    .map(([name, { sum, count }]) => ({
      name,
      avgPercent: count ? Math.round((sum / count) * 100) / 100 : 0,
      percent: count ? Math.round((sum / count) * 100) / 100 : 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const allMonths = Array.from(new Set([
    ...Array.from(byMonth.keys()),
    ...Array.from(complaintByMonth.keys()),
    ...Array.from(capaByMonth.keys()),
  ])).sort();

  return {
    monthlyTrend: Array.from(byMonth.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    byClassification: toSorted(byClassification),
    byProduct: toSorted(byProduct),
    byMarket: toSorted(byMarket),
    recoveryTrend,
    openVsClosed: [
      { name: 'Open', count: openCount },
      { name: 'Closed', count: closedCount },
    ],
    complaintLinkedTrend: allMonths.map((name) => ({
      name,
      count: complaintByMonth.get(name) || 0,
    })),
    capaLinkedTrend: allMonths.map((name) => ({
      name,
      count: capaByMonth.get(name) || 0,
    })),
  };
}

export function getRecentRecalls(records: RecallRecord[], limit = 10): RecallRecord[] {
  return [...records]
    .sort((a, b) => (b.updated_at || b.recall_date).localeCompare(a.updated_at || a.recall_date))
    .slice(0, limit);
}

export function getOpenRecoveryRows(records: RecallRecord[]): RecallOpenRecoveryRow[] {
  return records
    .filter((r) => isRecoveryInProgress(r) || (isRecallOpen(r.recall_status) && (r.distributed_quantity ?? 0) > 0))
    .map((r) => ({
      id: r.id,
      recall_number: r.recall_number,
      product_name: r.product_name,
      batch_number: r.batch_number,
      distributed_quantity: r.distributed_quantity ?? 0,
      recovered_quantity: r.recovered_quantity ?? 0,
      recovery_percent: getRecallRecoveryPercent(r),
      responsible_person: r.responsible_person_name || r.recall_initiated_by_name || r.created_by_name || '—',
      due_date: getRecallDueDate(r),
    }))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 20);
}

export function getRegulatoryPendingRows(records: RecallRecord[]): RecallRegulatoryPendingRow[] {
  return records
    .filter(isRegulatoryPending)
    .map((r) => ({
      id: r.id,
      recall_number: r.recall_number,
      market_region: r.market_region,
      recall_classification: r.recall_classification,
      notification_required: r.regulatory_notification_required ? 'Yes' : 'No',
      due_date: getRecallDueDate(r),
      status: r.regulatory_notified ? 'Notified' : 'Pending',
    }))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 20);
}

export function buildRecallActivityTimeline(records: RecallRecord[]): RecallActivityEntry[] {
  return getRecentRecalls(records, 15).map((r) => ({
    date: r.updated_at || r.recall_date,
    title: `${r.recall_number} — ${r.recall_status.replace(/_/g, ' ')}`,
    description: `${r.product_name} · Recovery ${getRecallRecoveryPercent(r)}%`,
    user: r.updated_by_name || r.created_by_name,
    recall_number: r.recall_number,
  }));
}

export function exportRecallDashboardCsv(records: RecallRecord[]): { headers: string[]; rows: string[][] } {
  const headers = [
    'Recall No', 'Date', 'Product', 'Batch', 'Market', 'Type', 'Classification',
    'Recovery %', 'Status', 'CAPA Linked', 'Complaint Linked',
  ];
  const rows = records.map((r) => [
    r.recall_number,
    r.recall_date,
    r.product_name,
    r.batch_number,
    r.market_region,
    r.recall_type,
    r.recall_classification,
    String(getRecallRecoveryPercent(r)),
    r.recall_status,
    isRecallCapaLinked(r) ? 'Yes' : 'No',
    isRecallComplaintLinked(r) ? 'Yes' : 'No',
  ]);
  return { headers, rows };
}

export {
  canExportRecallDashboard,
  canViewRecallDashboard,
  isRecallDashboardReadOnly,
};

import { normalizeRole } from '@/lib/permissions';
import type {
  CapaDashboardMetrics,
  CapaFilters,
  CapaRecord,
  CapaActivityEntry,
} from '@/lib/capa-types';
import { isCapaClosed } from '@/lib/capa-types';

export const CAPA_DASHBOARD_MODULE = 'CAPA Dashboard';

export type CapaDashboardActor = { id: string; name: string; role?: string; department?: string };

export interface CapaChartPoint {
  name: string;
  count?: number;
  value?: number;
  open?: number;
  closed?: number;
  overdue?: number;
  avgDays?: number;
  month?: string;
}

export interface CapaDashboardChartData {
  monthlyTrend: CapaChartPoint[];
  bySource: CapaChartPoint[];
  byDepartment: CapaChartPoint[];
  byStatus: CapaChartPoint[];
  openClosedTrend: CapaChartPoint[];
  overdueTrend: CapaChartPoint[];
  effectiveness: CapaChartPoint[];
  closureTimeTrend: CapaChartPoint[];
}

export const KPI_FILTER_MAP: Record<string, Partial<CapaFilters>> = {
  total: {},
  open: { kpi_filter: 'open' },
  closed: { kpi_filter: 'closed' },
  draft: { kpi_filter: 'draft' },
  under_implementation: { kpi_filter: 'under_implementation' },
  effectiveness_pending: { kpi_filter: 'effectiveness_pending' },
  overdue: { kpi_filter: 'overdue', overdue_only: true },
  critical: { kpi_filter: 'critical' },
  high_priority: { kpi_filter: 'high_priority' },
  effective: { kpi_filter: 'effective' },
  not_effective: { kpi_filter: 'not_effective' },
  due_this_week: { kpi_filter: 'due_this_week' },
  deviation_linked: { kpi_filter: 'deviation_linked' },
  oos_linked: { kpi_filter: 'oos_linked' },
  audit_linked: { kpi_filter: 'audit_linked' },
};

function daysBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

export function isCapaOverdue(record: CapaRecord): boolean {
  if (isCapaClosed(record.capa_status) || record.capa_status === 'rejected') return false;
  if (record.capa_status === 'overdue') return true;
  if (record.target_completion_date && record.target_completion_date < todayIso()) return true;
  return false;
}

export function getCapaDaysOverdue(record: CapaRecord): number {
  if (!isCapaOverdue(record) || !record.target_completion_date) return 0;
  return daysBetween(record.target_completion_date, todayIso());
}

function toSorted(m: Map<string, number>): CapaChartPoint[] {
  return Array.from(m.entries())
    .map(([name, count]) => ({ name, count, value: count }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
}

export function applyCapaDashboardFilters(records: CapaRecord[], filters?: CapaFilters): CapaRecord[] {
  let results = [...records];
  const f = filters || {};

  if (f.kpi_filter === 'open') results = results.filter((r) => !isCapaClosed(r.capa_status) && r.capa_status !== 'rejected');
  if (f.kpi_filter === 'closed') results = results.filter((r) => r.capa_status === 'closed' || r.capa_status === 'approved');
  if (f.kpi_filter === 'draft') results = results.filter((r) => r.capa_status === 'draft');
  if (f.kpi_filter === 'under_implementation') {
    results = results.filter((r) => ['assigned', 'under_implementation', 'implemented'].includes(r.capa_status));
  }
  if (f.kpi_filter === 'effectiveness_pending') {
    results = results.filter((r) => r.capa_status === 'effectiveness_pending' || r.effectiveness_result === 'Pending');
  }
  if (f.kpi_filter === 'overdue' || f.overdue_only) results = results.filter(isCapaOverdue);
  if (f.kpi_filter === 'critical') results = results.filter((r) => r.priority === 'critical');
  if (f.kpi_filter === 'high_priority') results = results.filter((r) => r.priority === 'high');
  if (f.kpi_filter === 'effective') results = results.filter((r) => r.effectiveness_result === 'Effective');
  if (f.kpi_filter === 'not_effective') results = results.filter((r) => r.effectiveness_result === 'Not Effective');
  if (f.kpi_filter === 'due_this_week') {
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    results = results.filter((r) => {
      if (!r.target_completion_date || isCapaClosed(r.capa_status)) return false;
      const due = new Date(r.target_completion_date);
      return due >= new Date() && due <= weekEnd;
    });
  }
  if (f.kpi_filter === 'deviation_linked') results = results.filter((r) => Boolean(r.deviation_id));
  if (f.kpi_filter === 'oos_linked') results = results.filter((r) => Boolean(r.oos_id));
  if (f.kpi_filter === 'audit_linked') results = results.filter((r) => Boolean(r.audit_id));

  if (f.status && f.status !== 'all') results = results.filter((r) => r.capa_status === f.status);
  if (f.source && f.source !== 'all') results = results.filter((r) => r.capa_source === f.source);
  if (f.department && f.department !== 'all') results = results.filter((r) => r.department === f.department);
  if (f.priority && f.priority !== 'all') results = results.filter((r) => r.priority === f.priority);
  if (f.owner && f.owner !== 'all') {
    const q = f.owner.toLowerCase();
    results = results.filter((r) =>
      (r.action_owner_name || '').toLowerCase().includes(q)
      || (r.action_owner || '').toLowerCase().includes(q),
    );
  }
  if (f.effectiveness_result && f.effectiveness_result !== 'all') {
    results = results.filter((r) => r.effectiveness_result === f.effectiveness_result);
  }
  if (f.date_from) results = results.filter((r) => r.capa_date >= f.date_from!);
  if (f.date_to) results = results.filter((r) => r.capa_date <= f.date_to!);
  if (f.capa_number) results = results.filter((r) => (r.capa_number || '').toLowerCase().includes(f.capa_number!.toLowerCase()));
  if (f.search) {
    const q = f.search.toLowerCase();
    results = results.filter((r) =>
      (r.capa_number || '').toLowerCase().includes(q)
      || (r.capa_title || '').toLowerCase().includes(q)
      || (r.product_name || '').toLowerCase().includes(q)
      || (r.batch_number || '').toLowerCase().includes(q)
      || (r.action_owner_name || '').toLowerCase().includes(q),
    );
  }
  return results;
}

export function filterCapaByRole(
  records: CapaRecord[],
  role?: string | null,
  userId?: string,
  userDepartment?: string,
): CapaRecord[] {
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'auditor', 'viewer'].includes(r)) {
    return records;
  }
  return records.filter((rec) =>
    rec.action_owner === userId
    || rec.created_by === userId
    || (userDepartment && rec.department?.toLowerCase() === userDepartment.toLowerCase()),
  );
}

export function computeExtendedCapaDashboardMetrics(records: CapaRecord[]): CapaDashboardMetrics {
  const today = new Date();
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);

  const closedRecords = records.filter((r) => r.capa_status === 'closed' || r.capa_status === 'approved');
  const closureDays = closedRecords
    .map((r) => {
      const end = r.actual_completion_date || r.updated_at?.split('T')[0];
      if (!end || !r.capa_date) return null;
      return daysBetween(r.capa_date, end);
    })
    .filter((d): d is number => d !== null);
  const avgClosureDays = closureDays.length
    ? Math.round(closureDays.reduce((a, b) => a + b, 0) / closureDays.length)
    : 0;

  return {
    total: records.length,
    open: records.filter((r) => !isCapaClosed(r.capa_status) && r.capa_status !== 'rejected').length,
    closed: records.filter((r) => r.capa_status === 'closed' || r.capa_status === 'approved').length,
    draft: records.filter((r) => r.capa_status === 'draft').length,
    underImplementation: records.filter((r) =>
      ['assigned', 'under_implementation', 'implemented'].includes(r.capa_status),
    ).length,
    effectivenessPending: records.filter((r) =>
      r.capa_status === 'effectiveness_pending' || r.effectiveness_result === 'Pending',
    ).length,
    overdue: records.filter(isCapaOverdue).length,
    critical: records.filter((r) => r.priority === 'critical').length,
    highPriority: records.filter((r) => r.priority === 'high').length,
    effective: records.filter((r) => r.effectiveness_result === 'Effective').length,
    notEffective: records.filter((r) => r.effectiveness_result === 'Not Effective').length,
    dueThisWeek: records.filter((r) => {
      if (!r.target_completion_date || isCapaClosed(r.capa_status)) return false;
      const due = new Date(r.target_completion_date);
      return due >= today && due <= weekEnd;
    }).length,
    deviationLinked: records.filter((r) => Boolean(r.deviation_id)).length,
    oosLinked: records.filter((r) => Boolean(r.oos_id)).length,
    auditLinked: records.filter((r) => Boolean(r.audit_id)).length,
    avgClosureDays,
  };
}

export function computeCapaChartData(records: CapaRecord[]): CapaDashboardChartData {
  const monthTrend = new Map<string, number>();
  const openClosed = new Map<string, { open: number; closed: number }>();
  const overdueTrend = new Map<string, number>();
  const closureTime = new Map<string, { total: number; count: number }>();
  const deptMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  const statusMap = new Map<string, number>();

  for (const r of records) {
    const month = r.capa_date?.slice(0, 7) || r.created_at?.slice(0, 7) || 'Unknown';
    monthTrend.set(month, (monthTrend.get(month) || 0) + 1);

    const oc = openClosed.get(month) || { open: 0, closed: 0 };
    if (isCapaClosed(r.capa_status)) oc.closed += 1;
    else if (r.capa_status !== 'rejected') oc.open += 1;
    openClosed.set(month, oc);

    if (isCapaOverdue(r)) {
      overdueTrend.set(month, (overdueTrend.get(month) || 0) + 1);
    }

    if (isCapaClosed(r.capa_status)) {
      const end = r.actual_completion_date || r.updated_at?.split('T')[0];
      if (end && r.capa_date) {
        const ct = closureTime.get(month) || { total: 0, count: 0 };
        ct.total += daysBetween(r.capa_date, end);
        ct.count += 1;
        closureTime.set(month, ct);
      }
    }

    deptMap.set(r.department || 'Unknown', (deptMap.get(r.department || 'Unknown') || 0) + 1);
    sourceMap.set(r.capa_source || 'Other', (sourceMap.get(r.capa_source || 'Other') || 0) + 1);
    statusMap.set(r.capa_status || 'unknown', (statusMap.get(r.capa_status || 'unknown') || 0) + 1);
  }

  const sortedMonths = Array.from(new Set([
    ...Array.from(monthTrend.keys()),
    ...Array.from(openClosed.keys()),
  ])).sort();

  return {
    monthlyTrend: sortedMonths.map((month) => ({ name: month, month, count: monthTrend.get(month) || 0 })),
    byDepartment: toSorted(deptMap),
    bySource: toSorted(sourceMap),
    byStatus: toSorted(statusMap).map((d) => ({
      ...d,
      name: d.name.replace(/_/g, ' '),
    })),
    openClosedTrend: sortedMonths.map((month) => ({
      name: month,
      month,
      open: openClosed.get(month)?.open || 0,
      closed: openClosed.get(month)?.closed || 0,
    })),
    overdueTrend: sortedMonths.map((month) => ({
      name: month,
      month,
      count: overdueTrend.get(month) || 0,
    })),
    effectiveness: [
      { name: 'Effective', count: records.filter((r) => r.effectiveness_result === 'Effective').length, value: records.filter((r) => r.effectiveness_result === 'Effective').length },
      { name: 'Not Effective', count: records.filter((r) => r.effectiveness_result === 'Not Effective').length, value: records.filter((r) => r.effectiveness_result === 'Not Effective').length },
      { name: 'Pending', count: records.filter((r) => r.effectiveness_result === 'Pending').length, value: records.filter((r) => r.effectiveness_result === 'Pending').length },
    ],
    closureTimeTrend: sortedMonths.map((month) => {
      const ct = closureTime.get(month);
      return {
        name: month,
        month,
        avgDays: ct?.count ? Math.round(ct.total / ct.count) : 0,
      };
    }),
  };
}

export function buildCapaActivityTimeline(records: CapaRecord[]): CapaActivityEntry[] {
  return records
    .slice(0, 15)
    .map((r) => ({
      date: r.updated_at || r.created_at,
      title: `${r.capa_number} — ${(r.capa_status || '').replace(/_/g, ' ')}`,
      description: (r.capa_title || '').slice(0, 100),
      user: r.updated_by_name || r.created_by_name || 'System',
      capa_id: r.id,
      capa_number: r.capa_number,
    }));
}

export function getRecentCapas(records: CapaRecord[], limit = 10): CapaRecord[] {
  return [...records]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .slice(0, limit);
}

export function getOverdueCapas(records: CapaRecord[]): CapaRecord[] {
  return records
    .filter(isCapaOverdue)
    .sort((a, b) => getCapaDaysOverdue(b) - getCapaDaysOverdue(a));
}

export function getEffectivenessPendingCapas(records: CapaRecord[]): CapaRecord[] {
  return records.filter((r) =>
    r.capa_status === 'effectiveness_pending'
    || (r.effectiveness_check_required && r.effectiveness_result === 'Pending'),
  );
}

export function canViewCapaDashboard(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive',
    'auditor', 'viewer', 'production_manager', 'production',
  ].includes(r);
}

export function canExportCapaDashboard(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive'].includes(r);
}

export function isCapaDashboardReadOnly(role?: string | null): boolean {
  return ['auditor', 'viewer'].includes(normalizeRole(role));
}

export function exportCapaDashboardCsv(records: CapaRecord[]): { headers: string[]; rows: string[][] } {
  const headers = ['CAPA No', 'Source', 'Department', 'Title', 'Owner', 'Due Date', 'Status', 'Priority', 'Effectiveness'];
  const rows = records.map((r) => [
    r.capa_number,
    r.capa_source,
    r.department,
    r.capa_title,
    r.action_owner_name || r.action_owner,
    r.target_completion_date || '',
    r.capa_status,
    r.priority,
    r.effectiveness_result || '',
  ]);
  return { headers, rows };
}

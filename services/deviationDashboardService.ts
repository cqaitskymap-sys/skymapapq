import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import {
  applyOverdueCheck,
  computeExtendedDashboardMetrics,
  getDaysOverdue,
  getDaysPending,
} from '@/lib/deviation-dashboard-metrics';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { listDeviations, syncOverdueStatuses } from '@/lib/deviation-service';
import { normalizeRole } from '@/lib/permissions';
import {
  DEVIATION_COLLECTIONS,
  isOpenStatus,
  type DeviationActivityEntry,
  type DeviationDashboardMetrics,
  type DeviationFilters,
  type DeviationKpiFilter,
  type DeviationRecord,
} from '@/lib/deviation-types';

export type DeviationDashboardActor = { id: string; name: string; role?: string };

export interface DeviationDashboardData {
  records: DeviationRecord[];
  metrics: DeviationDashboardMetrics;
  activity: DeviationActivityEntry[];
  error?: string;
}

export { getDaysOverdue, getDaysPending, computeExtendedDashboardMetrics };

export function canAccessDeviationDashboard(role?: string | null): boolean {
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'auditor', 'viewer'].includes(r)) return true;
  if (['qc_manager', 'qc', 'production_manager', 'production', 'engineering_manager', 'engineering',
    'warehouse_manager', 'warehouse', 'regulatory_affairs'].includes(r)) return true;
  return false;
}

export function canExportDeviationDashboard(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(r);
}

export function filterDeviationsByRole(records: DeviationRecord[], role?: string | null): DeviationRecord[] {
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'auditor', 'viewer', 'regulatory_affairs'].includes(r)) {
    return records;
  }
  const deptByRole: Record<string, string> = {
    production_manager: 'Production',
    production: 'Production',
    qc_manager: 'QC',
    qc: 'QC',
    engineering_manager: 'Engineering',
    engineering: 'Engineering',
    warehouse_manager: 'Warehouse',
    warehouse: 'Warehouse',
  };
  const dept = deptByRole[r];
  if (!dept) return records;
  return records.filter((rec) =>
    rec.department === dept || (rec.department || '').toLowerCase().includes(dept.toLowerCase()),
  );
}

function matchesKpiFilter(record: DeviationRecord, filter: DeviationKpiFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'open': return isOpenStatus(record.status) && record.status !== 'rejected';
    case 'closed': return record.status === 'closed' || record.status === 'approved';
    case 'draft': return record.status === 'draft';
    case 'under_investigation': return record.status === 'under_investigation';
    case 'qa_review': return record.status === 'qa_review';
    case 'capa_required': return Boolean(record.capa_required);
    case 'capa_linked': return Boolean(record.linked_capa_number);
    case 'overdue': return record.status === 'overdue' || getDaysOverdue(record) > 0;
    case 'critical': return record.criticality === 'Critical';
    case 'major': return record.criticality === 'Major';
    case 'minor': return record.criticality === 'Minor';
    case 'repeat': return Boolean(record.repeat_deviation);
    case 'batch_impacted': return Boolean(record.batch_impacted);
    case 'product_quality': return Boolean(record.product_quality_impacted);
    case 'patient_safety': return Boolean(record.patient_safety_impacted);
    default: return true;
  }
}

export function applyDashboardFilters(
  records: DeviationRecord[],
  filters?: DeviationFilters,
): DeviationRecord[] {
  let results = records.map(applyOverdueCheck);

  if (filters?.kpi_filter && filters.kpi_filter !== 'all') {
    results = results.filter((r) => matchesKpiFilter(r, filters.kpi_filter!));
  }
  if (filters?.status) results = results.filter((r) => r.status === filters.status);
  if (filters?.department) results = results.filter((r) => r.department === filters.department);
  if (filters?.category) results = results.filter((r) => r.category === filters.category);
  if (filters?.criticality) results = results.filter((r) => r.criticality === filters.criticality);
  if (filters?.product_name) {
    const q = filters.product_name.toLowerCase();
    results = results.filter((r) => (r.product_name || '').toLowerCase().includes(q));
  }
  if (filters?.batch_number) {
    results = results.filter((r) => (r.batch_number || '').includes(filters.batch_number!));
  }
  if (filters?.deviation_number) {
    results = results.filter((r) => (r.deviation_number || '').includes(filters.deviation_number!));
  }
  if (filters?.capa_required !== undefined) {
    results = results.filter((r) => r.capa_required === filters.capa_required);
  }
  if (filters?.date_from) results = results.filter((r) => r.deviation_date >= filters.date_from!);
  if (filters?.date_to) results = results.filter((r) => r.deviation_date <= filters.date_to!);
  if (filters?.assigned_to) {
    const q = filters.assigned_to.toLowerCase();
    results = results.filter((r) => (r.assigned_investigator_name || '').toLowerCase().includes(q));
  }
  if (filters?.overdue_only) {
    results = results.filter((r) => r.status === 'overdue' || getDaysOverdue(r) > 0);
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    results = results.filter((r) =>
      (r.deviation_number || '').toLowerCase().includes(q) ||
      (r.title || '').toLowerCase().includes(q) ||
      (r.product_name || '').toLowerCase().includes(q) ||
      (r.batch_number || '').toLowerCase().includes(q),
    );
  }

  return results;
}

async function loadAuditActivity(max = 30): Promise<DeviationActivityEntry[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.auditLogs),
      orderBy('dateTime', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => d.data())
      .filter((row) => String(row.module || row.moduleName || '') === 'Deviation')
      .map((row) => ({
        action: String(row.actionType || row.action || 'Activity'),
        user: String(row.userName || row.user_name || 'System'),
        at: String(row.dateTime || row.timestamp || row.created_at || ''),
        detail: String(row.actionDescription || row.reason || ''),
        deviationId: String(row.recordId || row.record_id || ''),
      }));
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), 'audit_trail'),
        orderBy('dateTime', 'desc'),
        limit(max),
      ));
      return snap.docs
        .map((d) => d.data())
        .filter((row) => String(row.moduleName || '').includes('Deviation'))
        .map((row) => ({
          action: String(row.actionType || 'Activity'),
          user: String(row.userName || 'System'),
          at: String(row.dateTime || row.timestamp || ''),
          detail: String(row.actionDescription || ''),
          deviationId: String(row.recordId || ''),
        }));
    } catch (e) {
      console.error('loadAuditActivity', e);
      return [];
    }
  }
}

function buildRecentActivity(records: DeviationRecord[], audit: DeviationActivityEntry[]): DeviationActivityEntry[] {
  const fromRecords: DeviationActivityEntry[] = records.slice(0, 8).map((r) => ({
    action: `Deviation ${r.status.replace(/_/g, ' ')}`,
    user: r.updated_by_name || r.created_by_name || 'System',
    at: r.updated_at || r.created_at,
    detail: `${r.deviation_number} — ${r.title}`,
    deviationId: r.id,
  }));
  return [...audit, ...fromRecords]
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
    .slice(0, 15);
}

export async function fetchDeviationDashboardData(
  filters?: DeviationFilters,
  role?: string | null,
): Promise<DeviationDashboardData> {
  if (!isFirebaseConfigured()) {
    return {
      records: [],
      metrics: computeExtendedDashboardMetrics([]),
      activity: [],
      error: 'Firebase is not configured. Set environment variables to load deviation data.',
    };
  }

  try {
    await syncOverdueStatuses();
    const raw = await listDeviations();
    const scoped = filterDeviationsByRole(raw, role);
    const filtered = applyDashboardFilters(scoped, filters);
    const activity = buildRecentActivity(filtered, await loadAuditActivity());
    return {
      records: filtered,
      metrics: computeExtendedDashboardMetrics(filtered),
      activity,
    };
  } catch (e) {
    console.error('fetchDeviationDashboardData', e);
    return {
      records: [],
      metrics: computeExtendedDashboardMetrics([]),
      activity: [],
      error: e instanceof Error ? e.message : 'Failed to load deviation dashboard data',
    };
  }
}

export async function logDeviationDashboardAudit(
  actionType:
    | 'Dashboard Viewed'
    | 'Dashboard Refreshed'
    | 'Filter Applied'
    | 'PDF Export Clicked'
    | 'Excel Export Clicked'
    | 'Deviation Opened',
  user: DeviationDashboardActor,
  detail?: string,
  recordId = 'deviation-dashboard',
): Promise<void> {
  try {
    await createAuditLog({
      moduleName: 'Deviation Dashboard',
      collectionName: DEVIATION_COLLECTIONS.deviations,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: user.id || 'system', name: user.name || 'User' },
      status: 'Success',
    });
  } catch (e) {
    console.error('logDeviationDashboardAudit', e);
  }
}

export function getRecentDeviations(records: DeviationRecord[], max = 15): DeviationRecord[] {
  return [...records]
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, max);
}

export function getOverdueDeviations(records: DeviationRecord[]): DeviationRecord[] {
  return records
    .filter((r) => r.status === 'overdue' || getDaysOverdue(r) > 0)
    .sort((a, b) => getDaysOverdue(b) - getDaysOverdue(a));
}

export function getCriticalDeviations(records: DeviationRecord[]): DeviationRecord[] {
  return records
    .filter((r) =>
      r.criticality === 'Critical' ||
      r.criticality === 'Major' ||
      r.patient_safety_impacted ||
      r.risk_assessment === 'critical' ||
      r.risk_assessment === 'high',
    )
    .sort((a, b) => {
      if (a.criticality === 'Critical' && b.criticality !== 'Critical') return -1;
      if (b.criticality === 'Critical' && a.criticality !== 'Critical') return 1;
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    });
}

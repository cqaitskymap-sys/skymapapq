import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { downloadCsv } from '@/lib/export-utils';
import {
  RECALL_DASHBOARD_MODULE,
  applyRecallDashboardFilters,
  buildRecallActivityTimeline,
  computeRecallChartData,
  computeRecallDashboardMetrics,
  exportRecallDashboardCsv,
  filterRecallsByRole,
  getOpenRecoveryRows,
  getRecentRecalls,
  getRegulatoryPendingRows,
  type RecallDashboardActor,
} from '@/lib/recall-dashboard-records';
import {
  RECALL_COLLECTIONS,
  type RecallActivityEntry,
  type RecallDashboardChartData,
  type RecallDashboardMetrics,
  type RecallFilters,
  type RecallOpenRecoveryRow,
  type RecallRecord,
  type RecallRegulatoryPendingRow,
} from '@/lib/recall-types';
import { listRecalls } from '@/lib/recall-service';
import {
  collection, getDocs, limit, orderBy, query,
} from 'firebase/firestore';

export type { RecallDashboardActor };

export interface RecallDashboardData {
  records: RecallRecord[];
  metrics: RecallDashboardMetrics;
  charts: RecallDashboardChartData;
  recentRecalls: RecallRecord[];
  openRecovery: RecallOpenRecoveryRow[];
  regulatoryPending: RecallRegulatoryPendingRow[];
  activity: RecallActivityEntry[];
}

async function audit(actor: RecallDashboardActor, actionType: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: RECALL_DASHBOARD_MODULE,
      collectionName: RECALL_COLLECTIONS.records,
      recordId: 'dashboard',
      actionType,
      actionDescription: detail || actionType,
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('recall dashboard audit', e);
  }
}

async function fetchRecallAuditActivity(): Promise<RecallActivityEntry[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RECALL_COLLECTIONS.auditLogs),
      orderBy('dateTime', 'desc'),
      limit(25),
    ));
    return snap.docs
      .map((d) => d.data())
      .filter((raw) => String(raw.module || raw.moduleName || '').toLowerCase().includes('recall'))
      .map((raw) => ({
        date: String(raw.dateTime || raw.timestamp || raw.created_at || ''),
        title: String(raw.action || raw.actionType || 'Recall Activity'),
        description: String(raw.newValue || raw.actionDescription || raw.reason || '').slice(0, 120),
        user: String(raw.userName || raw.user?.name || 'System'),
        recall_number: String(raw.documentNumber || raw.recordId || ''),
      }));
  } catch {
    return [];
  }
}

export async function fetchRecallDashboardData(
  filters?: RecallFilters,
  actor?: RecallDashboardActor,
): Promise<RecallDashboardData> {
  const emptyMetrics = computeRecallDashboardMetrics([]);
  const emptyCharts = computeRecallChartData([]);

  if (!isFirebaseConfigured()) {
    return {
      records: [],
      metrics: emptyMetrics,
      charts: emptyCharts,
      recentRecalls: [],
      openRecovery: [],
      regulatoryPending: [],
      activity: [],
    };
  }

  try {
    const all = await listRecalls();
    const scoped = filterRecallsByRole(all, actor?.role, actor?.id);
    const filtered = applyRecallDashboardFilters(scoped, filters);
    const [auditActivity] = await Promise.all([
      fetchRecallAuditActivity().catch(() => []),
    ]);

    return {
      records: filtered,
      metrics: computeRecallDashboardMetrics(filtered),
      charts: computeRecallChartData(filtered),
      recentRecalls: getRecentRecalls(filtered),
      openRecovery: getOpenRecoveryRows(filtered),
      regulatoryPending: getRegulatoryPendingRows(filtered),
      activity: auditActivity.length ? auditActivity : buildRecallActivityTimeline(filtered),
    };
  } catch (e) {
    console.error('fetchRecallDashboardData', e);
    throw new Error('Failed to load recall dashboard data');
  }
}

export async function logRecallDashboardViewed(actor: RecallDashboardActor): Promise<void> {
  await audit(actor, 'Dashboard Viewed', 'Product recall dashboard opened');
}

export async function logRecallDashboardRefreshed(actor: RecallDashboardActor, count: number): Promise<void> {
  await audit(actor, 'Dashboard Refreshed', `${count} recall record(s) loaded`);
}

export async function logRecallDashboardFilterApplied(actor: RecallDashboardActor, filters: RecallFilters): Promise<void> {
  await audit(actor, 'Filter Applied', JSON.stringify(filters).slice(0, 200));
}

export async function logRecallDashboardPdfExport(actor: RecallDashboardActor, count: number): Promise<void> {
  await audit(actor, 'PDF Export Blocked', `Backend PDF export is not configured (${count} records)`);
}

export async function logRecallDashboardExcelExport(actor: RecallDashboardActor, count: number): Promise<void> {
  await audit(actor, 'Excel Export', `Dashboard Excel export (${count} records)`);
}

export async function logRecallRecordOpened(actor: RecallDashboardActor, recallId: string, recallNumber: string): Promise<void> {
  await audit(actor, 'Recall Opened', `${recallNumber} (${recallId})`);
}

export function exportRecallDashboardCsvDownload(records: RecallRecord[], filename = 'recall-dashboard.csv'): void {
  const { headers, rows } = exportRecallDashboardCsv(records);
  downloadCsv(filename, headers, rows);
}

export function openRecallDashboardPdfPlaceholder(
  records: RecallRecord[],
  metrics: RecallDashboardMetrics,
  generatedBy: string,
): void {
  void records;
  void metrics;
  void generatedBy;
  throw new Error('Recall dashboard PDF export backend is not configured.');
}

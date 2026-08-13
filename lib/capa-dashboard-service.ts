import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { downloadCsv } from '@/lib/export-utils';
import {
  CAPA_DASHBOARD_MODULE,
  applyCapaDashboardFilters,
  buildCapaActivityTimeline,
  computeCapaChartData,
  computeExtendedCapaDashboardMetrics,
  exportCapaDashboardCsv,
  filterCapaByRole,
  type CapaDashboardActor,
  type CapaDashboardChartData,
} from '@/lib/capa-dashboard-records';
import {
  CAPA_COLLECTIONS,
  type CapaActivityEntry,
  type CapaDashboardMetrics,
  type CapaFilters,
  type CapaRecord,
} from '@/lib/capa-types';
import { listCapas, syncOverdueCapas } from '@/lib/capa-service';
import {
  collection, getDocs, limit, orderBy, query,
} from 'firebase/firestore';

export type { CapaDashboardActor };

export interface CapaDashboardData {
  records: CapaRecord[];
  metrics: CapaDashboardMetrics;
  charts: CapaDashboardChartData;
  activity: CapaActivityEntry[];
}

async function audit(actor: CapaDashboardActor, actionType: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: CAPA_DASHBOARD_MODULE,
      collectionName: CAPA_COLLECTIONS.records,
      recordId: 'dashboard',
      actionType,
      actionDescription: detail || actionType,
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('capa dashboard audit', e);
  }
}

async function fetchCapaAuditActivity(): Promise<CapaActivityEntry[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.auditLogs),
      orderBy('dateTime', 'desc'),
      limit(20),
    ));
    return snap.docs
      .map((d) => d.data())
      .filter((raw) => String(raw.module || '').toLowerCase().includes('capa'))
      .map((raw) => ({
        date: String(raw.dateTime || raw.timestamp || ''),
        title: String(raw.action || 'CAPA Activity'),
        description: String(raw.newValue || raw.reason || '').slice(0, 120),
        user: String(raw.userName || 'System'),
        capa_number: String(raw.recordId || ''),
      }));
  } catch {
    return [];
  }
}

export async function fetchCapaDashboardData(
  filters?: CapaFilters,
  actor?: CapaDashboardActor,
): Promise<CapaDashboardData> {
  if (!isFirebaseConfigured()) {
    const emptyMetrics = computeExtendedCapaDashboardMetrics([]);
    return {
      records: [],
      metrics: emptyMetrics,
      charts: computeCapaChartData([]),
      activity: [],
    };
  }

  try {
    await syncOverdueCapas();
  } catch (e) {
    console.error('syncOverdueCapas', e);
  }

  let allRecords: CapaRecord[] = [];
  try {
    allRecords = await listCapas();
  } catch (e) {
    console.error('listCapas', e);
    const emptyMetrics = computeExtendedCapaDashboardMetrics([]);
    return {
      records: [],
      metrics: emptyMetrics,
      charts: computeCapaChartData([]),
      activity: [],
    };
  }

  const scoped = actor
    ? filterCapaByRole(allRecords, actor.role, actor.id, actor.department)
    : allRecords;
  const filtered = applyCapaDashboardFilters(scoped, filters);
  const metrics = computeExtendedCapaDashboardMetrics(filtered);

  let activity: CapaActivityEntry[] = [];
  try {
    const auditActivity = await fetchCapaAuditActivity();
    activity = auditActivity.length ? auditActivity : buildCapaActivityTimeline(filtered);
  } catch {
    activity = buildCapaActivityTimeline(filtered);
  }

  return {
    records: filtered,
    metrics,
    charts: computeCapaChartData(filtered),
    activity,
  };
}

export async function logCapaDashboardViewed(actor: CapaDashboardActor) {
  await audit(actor, 'dashboard viewed', 'CAPA dashboard opened');
}

export async function logCapaDashboardRefreshed(actor: CapaDashboardActor, count: number) {
  await audit(actor, 'dashboard refreshed', `${count} CAPA record(s) loaded`);
}

export async function logCapaDashboardFilterApplied(actor: CapaDashboardActor, filters: CapaFilters) {
  await audit(actor, 'filter applied', JSON.stringify(filters).slice(0, 200));
}

export async function logCapaDashboardPdfExport(actor: CapaDashboardActor, count: number) {
  await audit(actor, 'PDF export blocked', `Backend PDF export is not configured (${count} records)`);
}

export async function logCapaDashboardExcelExport(actor: CapaDashboardActor, count: number) {
  await audit(actor, 'Excel export clicked', `Dashboard Excel placeholder (${count} records)`);
}

export async function logCapaRecordOpened(actor: CapaDashboardActor, capaId: string, capaNumber: string) {
  await audit(actor, 'CAPA opened', `${capaNumber} (${capaId})`);
}

export function exportCapaDashboardCsvDownload(records: CapaRecord[], filename = 'capa-dashboard.csv') {
  const { headers, rows } = exportCapaDashboardCsv(records);
  downloadCsv(filename, headers, rows);
}

export function openCapaDashboardPdfPlaceholder(records: CapaRecord[], generatedBy: string): void {
  void records;
  void generatedBy;
  throw new Error('CAPA dashboard PDF export backend is not configured.');
}

export { computeCapaChartData, computeExtendedCapaDashboardMetrics };

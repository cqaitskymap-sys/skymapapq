import {
  collection, getDocs, limit, query, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { downloadCsv } from '@/lib/export-utils';
import {
  OOS_DASHBOARD_MODULE,
  applyOosDashboardFilters,
  computeExtendedOosDashboardMetrics,
  type OosDashboardActor,
} from '@/lib/oos-dashboard-records';
import {
  OOS_COLLECTIONS,
  type OosDashboardMetrics,
  type OosFilters,
  type OosImpactAssessment,
  type OosPhase1,
  type OosPhase2,
  type OosRecord,
} from '@/lib/oos-types';
import { listOosRecords, syncOverdueOos } from '@/lib/oos-service';

export type { OosDashboardActor };

export interface OosDashboardData {
  records: OosRecord[];
  metrics: OosDashboardMetrics;
  phase1Map: Map<string, OosPhase1>;
  phase2Map: Map<string, OosPhase2>;
  impactMap: Map<string, OosImpactAssessment>;
}

async function audit(actor: OosDashboardActor, actionType: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: OOS_DASHBOARD_MODULE,
      collectionName: OOS_COLLECTIONS.records,
      recordId: 'dashboard',
      actionType,
      actionDescription: detail || actionType,
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('oos dashboard audit', e);
  }
}

async function fetchCollectionByOosIds<T extends { oos_id: string }>(
  collectionName: string,
  oosIds: string[],
): Promise<T[]> {
  if (!isFirebaseConfigured() || !oosIds.length) return [];
  const results: T[] = [];
  const chunks = oosIds.slice(0, 200);
  try {
    for (const oosId of chunks) {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), collectionName),
        where('oos_id', '==', oosId),
        limit(1),
      ));
      if (!snap.empty) {
        results.push({ id: snap.docs[0].id, ...snap.docs[0].data() } as unknown as T);
      }
    }
  } catch (e) {
    console.error(`fetchCollectionByOosIds ${collectionName}`, e);
  }
  return results;
}

export async function fetchOosDashboardData(filters?: OosFilters): Promise<OosDashboardData> {
  if (!isFirebaseConfigured()) {
    return {
      records: [],
      metrics: computeExtendedOosDashboardMetrics([]),
      phase1Map: new Map(),
      phase2Map: new Map(),
      impactMap: new Map(),
    };
  }

  try {
    await syncOverdueOos();
  } catch (e) {
    console.error('syncOverdueOos', e);
  }

  let allRecords: OosRecord[] = [];
  try {
    allRecords = await listOosRecords();
  } catch (e) {
    console.error('listOosRecords', e);
    return {
      records: [],
      metrics: computeExtendedOosDashboardMetrics([]),
      phase1Map: new Map(),
      phase2Map: new Map(),
      impactMap: new Map(),
    };
  }

  const oosIds = allRecords.map((r) => r.id);
  const [phase1List, phase2List, impactList] = await Promise.all([
    fetchCollectionByOosIds<OosPhase1>(OOS_COLLECTIONS.phase1, oosIds),
    fetchCollectionByOosIds<OosPhase2>(OOS_COLLECTIONS.phase2, oosIds),
    fetchCollectionByOosIds<OosImpactAssessment>(OOS_COLLECTIONS.impactAssessments, oosIds),
  ]);

  const phase1Map = new Map(phase1List.map((p) => [p.oos_id, p]));
  const phase2Map = new Map(phase2List.map((p) => [p.oos_id, p]));
  const impactMap = new Map(impactList.map((p) => [p.oos_id, p]));

  const filtered = applyOosDashboardFilters(allRecords, filters, phase1Map, phase2Map, impactMap);
  const metrics = computeExtendedOosDashboardMetrics(filtered, phase1List, phase2List, impactList);

  return { records: filtered, metrics, phase1Map, phase2Map, impactMap };
}

export async function logOosDashboardViewed(actor: OosDashboardActor) {
  await audit(actor, 'dashboard viewed', 'OOS dashboard opened');
}

export async function logOosDashboardRefreshed(actor: OosDashboardActor, count: number) {
  await audit(actor, 'dashboard refreshed', `${count} OOS record(s) loaded`);
}

export async function logOosDashboardFilterApplied(actor: OosDashboardActor, filters: OosFilters) {
  await audit(actor, 'filter applied', JSON.stringify(filters).slice(0, 200));
}

export async function logOosDashboardPdfExport(actor: OosDashboardActor, count: number) {
  await audit(actor, 'PDF export blocked', `Backend PDF export is not configured (${count} records)`);
}

export async function logOosDashboardExcelExport(actor: OosDashboardActor, count: number) {
  await audit(actor, 'Excel export clicked', `Dashboard Excel placeholder (${count} records)`);
}

export async function logOosRecordOpened(actor: OosDashboardActor, oosId: string, oosNumber: string) {
  await audit(actor, 'OOS opened', `${oosNumber} (${oosId})`);
}

export function exportOosDashboardCsv(records: OosRecord[]) {
  downloadCsv(
    `oos-dashboard-${new Date().toISOString().split('T')[0]}.csv`,
    ['OOS No', 'Date', 'Department', 'Product', 'Batch', 'Test', 'Observed', 'Specification', 'Status', 'Assigned To', 'Due Date', 'CAPA'],
    records.map((r) => [
      r.oos_number,
      r.oos_date,
      r.department,
      r.product_name,
      r.batch_number,
      r.test_name,
      r.obtained_result || r.observed_result,
      r.specification,
      r.status,
      r.assigned_to_name || '—',
      r.target_closure_date || '—',
      r.linked_capa_number || '—',
    ]),
  );
}

export function openOosDashboardPdfPlaceholder(generatedBy: string, recordCount: number) {
  void generatedBy;
  void recordCount;
  throw new Error('OOS dashboard PDF export backend is not configured.');
}

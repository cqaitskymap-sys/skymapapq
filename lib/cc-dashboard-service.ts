import {
  collection, getDocs, limit, orderBy, query,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  listChanges,
  listAllRiskAssessments,
  syncOverdueChanges,
} from '@/lib/change-control-service';
import type { ChangeControlRecord, ChangeRiskAssessment } from '@/lib/change-control-types';
import {
  CC_DASHBOARD_MODULE,
  applyCcDashboardFilters,
  buildCcDashboardCharts,
  computeCcDashboardMetrics,
  filterRecordsForRole,
  toDashboardRow,
  type CcDashboardActivityEntry,
  type CcDashboardData,
  type CcDashboardFilters,
} from '@/lib/cc-dashboard-records';

export type CcDashboardActor = {
  id: string;
  name: string;
  role?: string;
  department?: string;
};

const nowIso = () => new Date().toISOString();

async function audit(actor: CcDashboardActor, actionType: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: CC_DASHBOARD_MODULE,
      collectionName: 'change_controls',
      recordId: 'cc-dashboard',
      actionType,
      actionDescription: detail || actionType,
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('cc dashboard audit', e);
  }
}

async function fetchAuditActivity(max = 20): Promise<CcDashboardActivityEntry[]> {
  if (!isFirebaseConfigured()) return [];
  const mapEntry = (data: Record<string, unknown>): CcDashboardActivityEntry | null => {
    const moduleName = String(data.moduleName || data.module_name || '');
    const collectionName = String(data.collectionName || data.collection_name || '');
    if (!/change control/i.test(moduleName) && !/change_controls/i.test(collectionName)) return null;
    return {
      action: String(data.actionType || data.action || 'Activity'),
      user: String(data.userName || data.user_name || 'System'),
      at: String(data.dateTime || data.timestamp || data.created_at || nowIso()),
      detail: String(data.actionDescription || data.reason || ''),
      recordId: String(data.recordId || data.documentId || ''),
    };
  };
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), 'audit_trail'),
      orderBy('dateTime', 'desc'),
      limit(max * 4),
    ));
    return snap.docs
      .map((d) => mapEntry(d.data() as Record<string, unknown>))
      .filter((e): e is CcDashboardActivityEntry => e !== null)
      .slice(0, max);
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), limit(max * 4)));
      return snap.docs
        .map((d) => mapEntry(d.data() as Record<string, unknown>))
        .filter((e): e is CcDashboardActivityEntry => e !== null)
        .slice(0, max);
    } catch (e) {
      console.error('fetchCcAuditActivity', e);
      return [];
    }
  }
}

function buildRiskMap(risks: ChangeRiskAssessment[]): Map<string, ChangeRiskAssessment> {
  const map = new Map<string, ChangeRiskAssessment>();
  risks.forEach((r) => {
    if (r.change_id) map.set(r.change_id, r);
  });
  return map;
}

function emptyDashboardData(): CcDashboardData {
  return {
    metrics: {
      total: 0, open: 0, closed: 0, draft: 0, underQaReview: 0,
      impactAssessmentPending: 0, riskAssessmentPending: 0, implementationInProgress: 0,
      effectivenessPending: 0, overdue: 0, critical: 0, validationImpact: 0,
      csvImpact: 0, trainingImpact: 0, regulatoryImpact: 0, capaLinked: 0, averageClosureDays: 0,
    },
    charts: {
      monthlyTrend: [], byDepartment: [], byType: [], byCategory: [], byPriority: [],
      openVsClosedTrend: [], validationImpactTrend: [], trainingImpactTrend: [],
      regulatoryImpactTrend: [], overdueTrend: [],
    },
    recentChanges: [],
    overdueChanges: [],
    criticalChanges: [],
    activity: [],
    departments: ['All'],
    filteredCount: 0,
  };
}

export async function fetchCcDashboardData(
  filters: CcDashboardFilters,
  actor: CcDashboardActor,
): Promise<CcDashboardData> {
  if (!isFirebaseConfigured()) return emptyDashboardData();

  try {
    await syncOverdueChanges().catch(() => 0);
    const [records, risks, activity] = await Promise.all([
      listChanges().catch(() => [] as ChangeControlRecord[]),
      listAllRiskAssessments().catch(() => [] as ChangeRiskAssessment[]),
      fetchAuditActivity(20),
    ]);

    const roleScoped = filterRecordsForRole(records, actor.role, actor.department, actor.id);
    const filtered = applyCcDashboardFilters(roleScoped, filters);
    const baseRecords = filtered;
    const riskMap = buildRiskMap(risks);
    const metrics = computeCcDashboardMetrics(filtered);
    const charts = buildCcDashboardCharts(baseRecords);
    const rows = baseRecords.map((r) => toDashboardRow(r, riskMap));

    const recentChanges = [...rows]
      .sort((a, b) => b.change_number.localeCompare(a.change_number))
      .slice(0, 20);

    const overdueChanges = rows
      .filter((r) => r.days_overdue > 0 || r.status === 'overdue')
      .sort((a, b) => b.days_overdue - a.days_overdue)
      .slice(0, 20);

    const criticalChanges = rows
      .filter((r) => r.change_category === 'Critical' || r.validation_impact || r.csv_impact || r.regulatory_impact || ['Critical', 'High'].includes(r.risk_level))
      .sort((a, b) => b.change_number.localeCompare(a.change_number))
      .slice(0, 20);

    const departments = ['All', ...Array.from(new Set(roleScoped.map((r) => r.department).filter(Boolean))).sort()];

    return {
      metrics,
      charts,
      recentChanges,
      overdueChanges,
      criticalChanges,
      activity,
      departments,
      filteredCount: filtered.length,
    };
  } catch (e) {
    console.error('fetchCcDashboardData', e);
    throw new Error(e instanceof Error ? e.message : 'Failed to load change control dashboard');
  }
}

export async function logCcDashboardViewed(actor: CcDashboardActor) {
  await audit(actor, 'DASHBOARD_VIEWED', 'Change Control Dashboard viewed');
}

export async function logCcDashboardRefreshed(actor: CcDashboardActor) {
  await audit(actor, 'DASHBOARD_REFRESHED', 'Change Control Dashboard refreshed');
}

export async function logCcDashboardFilterApplied(actor: CcDashboardActor, filters: CcDashboardFilters) {
  await audit(actor, 'FILTER_APPLIED', `Filters: ${JSON.stringify(filters)}`);
}

export async function logCcDashboardExport(actor: CcDashboardActor, type: 'PDF' | 'Excel') {
  const action = type === 'PDF' ? 'PDF_EXPORT_BLOCKED' : 'EXCEL_EXPORT_CLICKED';
  const detail = type === 'PDF'
    ? 'PDF export blocked: backend export service is not configured'
    : 'Excel export requested';
  await audit(actor, action, detail);
}

export async function logCcChangeOpened(actor: CcDashboardActor, changeId: string, changeNumber: string) {
  await audit(actor, 'CHANGE_CONTROL_OPENED', `Opened ${changeNumber} (${changeId})`);
}

export function openCcDashboardPdfPlaceholder(data: CcDashboardData, userName: string) {
  void data;
  void userName;
  throw new Error('Change control dashboard PDF export backend is not configured.');
}

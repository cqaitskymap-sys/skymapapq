import { normalizeRole } from '@/lib/permissions';
import type {
  OosDashboardMetrics,
  OosFilters,
  OosImpactAssessment,
  OosPhase1,
  OosPhase2,
  OosRecord,
  OosActivityEntry,
} from '@/lib/oos-types';
import {
  getDaysOverdueOos,
  isCriticalOosTest,
  isOpenOosStatus,
} from '@/lib/oos-types';

export const OOS_DASHBOARD_MODULE = 'OOS Dashboard';

export type OosDashboardActor = { id: string; name: string; role?: string; department?: string };

function daysBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
}

function toSorted(m: Map<string, number>) {
  return Array.from(m.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function applyOverdueCheck(record: OosRecord): OosRecord {
  if (!record.target_closure_date || ['closed', 'rejected', 'approved'].includes(record.status)) return record;
  const today = new Date().toISOString().split('T')[0];
  if (record.target_closure_date < today && isOpenOosStatus(record.status)) {
    return { ...record, status: 'overdue' };
  }
  return record;
}

function isManufacturingRelated(phase2?: OosPhase2 | null): boolean {
  if (!phase2) return false;
  const text = `${phase2.root_cause || ''} ${phase2.process_review || ''} ${phase2.equipment_review || ''} ${phase2.raw_material_review || ''}`.toLowerCase();
  return /manufactur|process|equipment|material|operator|production/.test(text);
}

function hasProductQualityImpact(impact?: OosImpactAssessment | null): boolean {
  if (!impact) return false;
  if (impact.product_quality_impact === 'Yes') return true;
  const fields = [impact.product_impact, impact.batch_impact, impact.patient_safety_impact];
  return fields.some((f) => /yes|significant|impact|fail/i.test(f || ''));
}

function normalizeRootCause(record: OosRecord, phase1?: OosPhase1 | null, phase2?: OosPhase2 | null): string {
  if (phase1?.phase1_outcome === 'Laboratory Error') return 'Laboratory Error';
  if (phase1?.phase1_outcome === 'Inconclusive' || record.root_cause?.toLowerCase().includes('inconclusive')) return 'Inconclusive';
  if (isManufacturingRelated(phase2)) return 'Manufacturing Error';
  if (phase2?.root_cause) {
    const rc = phase2.root_cause.toLowerCase();
    if (/equipment/.test(rc)) return 'Equipment Related';
    if (/material/.test(rc)) return 'Material Related';
    if (/method/.test(rc)) return 'Method Related';
    if (/environment/.test(rc)) return 'Environmental Related';
    if (/analyst/.test(rc)) return 'Analyst Error';
    return phase2.root_cause.slice(0, 40);
  }
  if (record.root_cause) return record.root_cause.slice(0, 40);
  return 'No Assignable Cause';
}

export function applyOosDashboardFilters(
  records: OosRecord[],
  filters?: OosFilters,
  phase1Map?: Map<string, OosPhase1>,
  phase2Map?: Map<string, OosPhase2>,
  impactMap?: Map<string, OosImpactAssessment>,
): OosRecord[] {
  let results = records.map(applyOverdueCheck);

  if (filters?.kpi_filter === 'open') results = results.filter((r) => isOpenOosStatus(r.status) && r.status !== 'rejected');
  if (filters?.kpi_filter === 'closed') results = results.filter((r) => ['closed', 'approved'].includes(r.status));
  if (filters?.kpi_filter === 'draft') results = results.filter((r) => r.status === 'draft');
  if (filters?.kpi_filter === 'phase1') results = results.filter((r) => r.status === 'phase1_investigation');
  if (filters?.kpi_filter === 'phase2') results = results.filter((r) => r.status === 'phase2_investigation');
  if (filters?.kpi_filter === 'qa_review') results = results.filter((r) => ['qa_review', 'final_qa_review'].includes(r.status));
  if (filters?.kpi_filter === 'capa_required') results = results.filter((r) => r.capa_required);
  if (filters?.kpi_filter === 'capa_linked') results = results.filter((r) => Boolean(r.linked_capa_number));
  if (filters?.kpi_filter === 'overdue') results = results.filter((r) => r.status === 'overdue' || getDaysOverdueOos(r) > 0);
  if (filters?.kpi_filter === 'critical') results = results.filter((r) => isCriticalOosTest(r.test_name) || (r.is_critical_test && r.result_status === 'OOS'));
  if (filters?.kpi_filter === 'lab_error') results = results.filter((r) => phase1Map?.get(r.id)?.phase1_outcome === 'Laboratory Error');
  if (filters?.kpi_filter === 'manufacturing') results = results.filter((r) => isManufacturingRelated(phase2Map?.get(r.id)));
  if (filters?.kpi_filter === 'inconclusive') results = results.filter((r) => phase1Map?.get(r.id)?.phase1_outcome === 'Inconclusive');
  if (filters?.kpi_filter === 'batch_blocked') results = results.filter((r) => r.batch_release_blocked);
  if (filters?.kpi_filter === 'product_quality') {
    results = results.filter((r) => hasProductQualityImpact(impactMap?.get(r.id)));
  }
  if (filters?.status) results = results.filter((r) => r.status === filters.status);
  if (filters?.department) results = results.filter((r) => r.department === filters.department);
  if (filters?.product_name) {
    const q = filters.product_name.toLowerCase();
    results = results.filter((r) => (r.product_name || '').toLowerCase().includes(q));
  }
  if (filters?.batch_number) results = results.filter((r) => (r.batch_number || '').includes(filters.batch_number!));
  if (filters?.oos_number) results = results.filter((r) => (r.oos_number || '').includes(filters.oos_number!));
  if (filters?.test_name) results = results.filter((r) => (r.test_name || '').toLowerCase().includes(filters.test_name!.toLowerCase()));
  if (filters?.assigned_to) {
    const q = filters.assigned_to.toLowerCase();
    results = results.filter((r) => (r.assigned_to_name || '').toLowerCase().includes(q));
  }
  if (filters?.root_cause) {
    results = results.filter((r) => normalizeRootCause(r, phase1Map?.get(r.id), phase2Map?.get(r.id)).toLowerCase().includes(filters.root_cause!.toLowerCase()));
  }
  if (filters?.capa_linked !== undefined) results = results.filter((r) => Boolean(r.linked_capa_number) === filters.capa_linked);
  if (filters?.capa_required !== undefined) results = results.filter((r) => r.capa_required === filters.capa_required);
  if (filters?.overdue_only) results = results.filter((r) => r.status === 'overdue' || getDaysOverdueOos(r) > 0);
  if (filters?.date_from) results = results.filter((r) => r.oos_date >= filters.date_from!);
  if (filters?.date_to) results = results.filter((r) => r.oos_date <= filters.date_to!);
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    results = results.filter((r) =>
      (r.oos_number || '').toLowerCase().includes(q)
      || (r.product_name || '').toLowerCase().includes(q)
      || (r.batch_number || '').toLowerCase().includes(q)
      || (r.test_name || '').toLowerCase().includes(q)
      || (r.assigned_to_name || '').toLowerCase().includes(q),
    );
  }
  return results;
}

export function computeExtendedOosDashboardMetrics(
  records: OosRecord[],
  phase1Records: OosPhase1[] = [],
  phase2Records: OosPhase2[] = [],
  impactRecords: OosImpactAssessment[] = [],
): OosDashboardMetrics {
  const checked = records.map(applyOverdueCheck);
  const phase1ByOos = new Map(phase1Records.map((p) => [p.oos_id, p]));
  const phase2ByOos = new Map(phase2Records.map((p) => [p.oos_id, p]));
  const impactByOos = new Map(impactRecords.map((p) => [p.oos_id, p]));

  const deptMap = new Map<string, number>();
  const prodMap = new Map<string, number>();
  const testMap = new Map<string, number>();
  const rootMap = new Map<string, number>();
  const monthMap = new Map<string, number>();
  const trendMap = new Map<string, { open: number; closed: number }>();
  const phaseMap = new Map<string, { phase1: number; phase2: number }>();
  const capaMap = new Map<string, { linked: number; notLinked: number }>();
  const batchImpactMap = new Map<string, number>();
  const closureMap = new Map<string, { totalDays: number; count: number }>();

  let closureTotalDays = 0;
  let closureCount = 0;

  for (const r of checked) {
    deptMap.set(r.department || 'Unknown', (deptMap.get(r.department || 'Unknown') || 0) + 1);
    prodMap.set(r.product_name || 'Unknown', (prodMap.get(r.product_name || 'Unknown') || 0) + 1);
    testMap.set(r.test_name || 'Unknown', (testMap.get(r.test_name || 'Unknown') || 0) + 1);

    const rc = normalizeRootCause(r, phase1ByOos.get(r.id), phase2ByOos.get(r.id));
    rootMap.set(rc, (rootMap.get(rc) || 0) + 1);

    const month = r.oos_date?.slice(0, 7) || r.created_at?.slice(0, 7) || 'Unknown';
    monthMap.set(month, (monthMap.get(month) || 0) + 1);

    const oc = trendMap.get(month) || { open: 0, closed: 0 };
    if (isOpenOosStatus(r.status) && r.status !== 'rejected') oc.open++;
    else if (['closed', 'approved'].includes(r.status)) oc.closed++;
    trendMap.set(month, oc);

    const ph = phaseMap.get(month) || { phase1: 0, phase2: 0 };
    if (r.status === 'phase1_investigation') ph.phase1++;
    if (r.status === 'phase2_investigation') ph.phase2++;
    phaseMap.set(month, ph);

    const capa = capaMap.get(month) || { linked: 0, notLinked: 0 };
    if (r.linked_capa_number) capa.linked++;
    else capa.notLinked++;
    capaMap.set(month, capa);

    if (r.batch_release_blocked) batchImpactMap.set(month, (batchImpactMap.get(month) || 0) + 1);

    if (r.actual_closure_date && r.oos_date) {
      const days = daysBetween(r.oos_date, r.actual_closure_date);
      closureTotalDays += days;
      closureCount++;
      const c = closureMap.get(month) || { totalDays: 0, count: 0 };
      c.totalDays += days;
      c.count++;
      closureMap.set(month, c);
    }
  }

  const byRootCause = toSorted(rootMap);
  const openClosedTrend = Array.from(trendMap.entries())
    .map(([month, v]) => ({ name: month, month, count: v.open + v.closed, open: v.open, closed: v.closed }))
    .sort((a, b) => (a.month || '').localeCompare(b.month || ''));

  const recentActivity: OosActivityEntry[] = [...checked]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .slice(0, 12)
    .map((r) => ({
      date: r.updated_at || r.created_at,
      title: (r.status || '').replace(/_/g, ' '),
      description: `${r.test_name} — ${r.product_name} / ${r.batch_number}`,
      user: r.updated_by_name || r.created_by_name,
      oosId: r.id,
      oosNumber: r.oos_number,
    }));

  return {
    total: checked.length,
    open: checked.filter((r) => isOpenOosStatus(r.status) && r.status !== 'rejected').length,
    closed: checked.filter((r) => ['closed', 'approved'].includes(r.status)).length,
    draft: checked.filter((r) => r.status === 'draft').length,
    phase1: checked.filter((r) => r.status === 'phase1_investigation').length,
    phase2: checked.filter((r) => r.status === 'phase2_investigation').length,
    qaReviewPending: checked.filter((r) => ['qa_review', 'final_qa_review'].includes(r.status)).length,
    capaRequired: checked.filter((r) => r.capa_required).length,
    capaLinked: checked.filter((r) => Boolean(r.linked_capa_number)).length,
    overdue: checked.filter((r) => r.status === 'overdue' || getDaysOverdueOos(r) > 0).length,
    critical: checked.filter((r) => isCriticalOosTest(r.test_name) || (r.is_critical_test && r.result_status === 'OOS')).length,
    laboratoryError: checked.filter((r) => phase1ByOos.get(r.id)?.phase1_outcome === 'Laboratory Error').length,
    manufacturingRelated: checked.filter((r) => isManufacturingRelated(phase2ByOos.get(r.id))).length,
    inconclusive: checked.filter((r) => phase1ByOos.get(r.id)?.phase1_outcome === 'Inconclusive').length,
    batchBlocked: checked.filter((r) => r.batch_release_blocked).length,
    productQualityImpact: checked.filter((r) => hasProductQualityImpact(impactByOos.get(r.id))).length,
    avgClosureDays: closureCount ? Math.round(closureTotalDays / closureCount) : 0,
    monthlyTrend: Array.from(monthMap.entries())
      .map(([month, count]) => ({ name: month, month, count }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
    byDepartment: toSorted(deptMap),
    byProduct: toSorted(prodMap).slice(0, 12),
    byTestName: toSorted(testMap).slice(0, 12),
    byRootCause,
    phaseTrend: Array.from(phaseMap.entries())
      .map(([month, v]) => ({ name: month, month, count: v.phase1 + v.phase2, phase1: v.phase1, phase2: v.phase2 }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
    openClosedTrend,
    capaLinkageTrend: Array.from(capaMap.entries())
      .map(([month, v]) => ({ name: month, month, count: v.linked + v.notLinked, linked: v.linked, notLinked: v.notLinked }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
    closureTimeTrend: Array.from(closureMap.entries())
      .map(([month, v]) => ({
        name: month,
        month,
        avgDays: v.count ? Math.round(v.totalDays / v.count) : 0,
        count: v.count,
      }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
    batchImpactTrend: Array.from(batchImpactMap.entries())
      .map(([month, count]) => ({ name: month, month, count }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
    rootCauseTrend: byRootCause,
    closureTrend: openClosedTrend,
    recentActivity,
  };
}

export function canViewOosDashboard(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'qc_manager', 'qc', 'production_manager', 'production', 'auditor', 'viewer'].includes(r);
}

export function canExportOosDashboard(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'auditor'].includes(r);
}

export function isOosDashboardReadOnly(role?: string | null): boolean {
  return normalizeRole(role) === 'auditor';
}

export const KPI_FILTER_MAP: Record<string, string> = {
  'Total OOS': 'all',
  'Open OOS': 'open',
  'Closed OOS': 'closed',
  'Draft OOS': 'draft',
  'Phase-I Investigation': 'phase1',
  'Phase-II Investigation': 'phase2',
  'QA Review Pending': 'qa_review',
  'CAPA Required': 'capa_required',
  'CAPA Linked': 'capa_linked',
  'Overdue OOS': 'overdue',
  'Critical OOS': 'critical',
  'Laboratory Error OOS': 'lab_error',
  'Manufacturing Related OOS': 'manufacturing',
  'Inconclusive OOS': 'inconclusive',
  'Batch Blocked OOS': 'batch_blocked',
  'Product Quality Impact OOS': 'product_quality',
};

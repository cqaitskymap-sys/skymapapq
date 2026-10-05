import {
  isOpenStatus,
  type DeviationDashboardMetrics,
  type DeviationRecord,
} from '@/lib/deviation-types';

import { localCalendarDate } from '@/lib/qms-record-guard';

const todayStr = () => localCalendarDate();

function daysBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
}

export function getDaysOverdue(record: DeviationRecord): number {
  if (!record.target_closure_date || record.status === 'closed' || record.status === 'rejected') return 0;
  const today = todayStr();
  if (record.target_closure_date >= today) return 0;
  return daysBetween(record.target_closure_date, today);
}

export function applyOverdueCheck(record: DeviationRecord): DeviationRecord {
  if (!record.target_closure_date || record.status === 'closed' || record.status === 'approved') {
    return record;
  }
  const today = todayStr();
  if (record.target_closure_date < today && isOpenStatus(record.status)) {
    return { ...record, status: 'overdue' };
  }
  return record;
}

function toSorted(m: Map<string, number>) {
  return Array.from(m.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function computeExtendedDashboardMetrics(records: DeviationRecord[]): DeviationDashboardMetrics {
  const checked = records.map(applyOverdueCheck);
  const deptMap = new Map<string, number>();
  const catMap = new Map<string, number>();
  const critMap = new Map<string, number>();
  const productMap = new Map<string, number>();
  const monthMap = new Map<string, number>();
  const trendMap = new Map<string, { open: number; closed: number }>();
  const capaMap = new Map<string, { required: number; notRequired: number }>();
  const batchImpactMap = new Map<string, number>();
  const repeatMap = new Map<string, number>();
  const closureMap = new Map<string, { totalDays: number; count: number }>();
  const rootCauseMap = new Map<string, number>();
  const capaLinkedMap = new Map<string, number>();

  let closureTotalDays = 0;
  let closureCount = 0;

  for (const r of checked) {
    deptMap.set(r.department || 'Unknown', (deptMap.get(r.department || 'Unknown') || 0) + 1);
    catMap.set(r.category || 'Other', (catMap.get(r.category || 'Other') || 0) + 1);
    critMap.set(r.criticality || 'Minor', (critMap.get(r.criticality || 'Minor') || 0) + 1);
    productMap.set(r.product_name || 'Unknown', (productMap.get(r.product_name || 'Unknown') || 0) + 1);

    const month = r.deviation_date?.slice(0, 7) || r.created_at?.slice(0, 7) || 'Unknown';
    monthMap.set(month, (monthMap.get(month) || 0) + 1);

    const trend = trendMap.get(month) || { open: 0, closed: 0 };
    if (isOpenStatus(r.status) && r.status !== 'rejected') trend.open++;
    else if (r.status === 'closed' || r.status === 'approved') trend.closed++;
    trendMap.set(month, trend);

    const capa = capaMap.get(month) || { required: 0, notRequired: 0 };
    if (r.capa_required) capa.required++;
    else capa.notRequired++;
    capaMap.set(month, capa);

    if (r.batch_impacted) batchImpactMap.set(month, (batchImpactMap.get(month) || 0) + 1);
    if (r.repeat_deviation) repeatMap.set(month, (repeatMap.get(month) || 0) + 1);
    if (r.linked_capa_number) capaLinkedMap.set(month, (capaLinkedMap.get(month) || 0) + 1);

    const rc = (r.root_cause || 'Not Documented').slice(0, 40);
    rootCauseMap.set(rc, (rootCauseMap.get(rc) || 0) + 1);

    if (r.actual_closure_date && r.deviation_date) {
      const days = daysBetween(r.deviation_date, r.actual_closure_date);
      closureTotalDays += days;
      closureCount++;
      const c = closureMap.get(month) || { totalDays: 0, count: 0 };
      c.totalDays += days;
      c.count++;
      closureMap.set(month, c);
    }
  }

  return {
    total: checked.length,
    open: checked.filter((r) => isOpenStatus(r.status) && r.status !== 'rejected').length,
    closed: checked.filter((r) => r.status === 'closed' || r.status === 'approved').length,
    draft: checked.filter((r) => r.status === 'draft').length,
    underInvestigation: checked.filter((r) => r.status === 'under_investigation').length,
    qaReviewPending: checked.filter((r) => r.status === 'qa_review').length,
    capaRequired: checked.filter((r) => r.capa_required).length,
    capaLinked: checked.filter((r) => Boolean(r.linked_capa_number)).length,
    overdue: checked.filter((r) => r.status === 'overdue' || getDaysOverdue(r) > 0).length,
    critical: checked.filter((r) => r.criticality === 'Critical').length,
    major: checked.filter((r) => r.criticality === 'Major').length,
    minor: checked.filter((r) => r.criticality === 'Minor').length,
    repeat: checked.filter((r) => r.repeat_deviation).length,
    batchImpacted: checked.filter((r) => r.batch_impacted).length,
    productQualityImpact: checked.filter((r) => r.product_quality_impacted).length,
    patientSafetyImpact: checked.filter((r) => r.patient_safety_impacted).length,
    avgClosureDays: closureCount ? Math.round(closureTotalDays / closureCount) : 0,
    byDepartment: toSorted(deptMap),
    byCategory: toSorted(catMap),
    byCriticality: toSorted(critMap),
    byProduct: toSorted(productMap).slice(0, 12),
    monthlyTrend: Array.from(monthMap.entries())
      .map(([month, count]) => ({ name: month, month, count }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
    openClosedTrend: Array.from(trendMap.entries())
      .map(([month, v]) => ({ name: month, month, open: v.open, closed: v.closed, count: v.open + v.closed }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
    capaTrend: Array.from(capaMap.entries())
      .map(([month, v]) => ({
        name: month,
        month,
        required: v.required,
        notRequired: v.notRequired,
        count: v.required + v.notRequired,
      }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
    batchImpactTrend: Array.from(batchImpactMap.entries())
      .map(([month, count]) => ({ name: month, month, count }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
    repeatTrend: Array.from(repeatMap.entries())
      .map(([month, count]) => ({ name: month, month, count }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
    closureTimeTrend: Array.from(closureMap.entries())
      .map(([month, v]) => ({
        name: month,
        month,
        avgDays: v.count ? Math.round(v.totalDays / v.count) : 0,
        count: v.count,
      }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
    byRootCause: toSorted(rootCauseMap).slice(0, 10),
    capaLinkedTrend: Array.from(capaLinkedMap.entries())
      .map(([month, count]) => ({ name: month, month, count }))
      .sort((a, b) => (a.month || '').localeCompare(b.month || '')),
  };
}

export function getDaysPending(record: DeviationRecord): number {
  const start = record.deviation_date || record.created_at?.slice(0, 10) || todayStr();
  const end = record.actual_closure_date || todayStr();
  return daysBetween(start, end);
}

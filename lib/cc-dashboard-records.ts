import { normalizeRole } from '@/lib/permissions';
import { localCalendarDate } from '@/lib/qms-record-guard';
import {
  CHANGE_CATEGORIES,
  CHANGE_PRIORITIES,
  CHANGE_TYPES,
  CC_DEPARTMENTS,
  type ChangeControlRecord,
  type ChangeRiskAssessment,
  isCcClosed,
} from '@/lib/change-control-types';

export const CC_DASHBOARD_MODULE = 'Change Control Dashboard';

export type CcDashboardKpiFilter =
  | 'all'
  | 'open'
  | 'closed'
  | 'draft'
  | 'under_qa_review'
  | 'impact_assessment'
  | 'risk_assessment'
  | 'implementation_in_progress'
  | 'effectiveness_pending'
  | 'overdue'
  | 'critical'
  | 'validation_impact'
  | 'csv_impact'
  | 'training_impact'
  | 'regulatory_impact'
  | 'capa_linked';

export interface CcDashboardFilters {
  department: string;
  change_type: string;
  change_category: string;
  change_priority: string;
  date_from: string;
  date_to: string;
  kpi_filter: CcDashboardKpiFilter;
}

export interface CcDashboardMetrics {
  total: number;
  open: number;
  closed: number;
  draft: number;
  underQaReview: number;
  impactAssessmentPending: number;
  riskAssessmentPending: number;
  implementationInProgress: number;
  effectivenessPending: number;
  overdue: number;
  critical: number;
  validationImpact: number;
  csvImpact: number;
  trainingImpact: number;
  regulatoryImpact: number;
  capaLinked: number;
  averageClosureDays: number;
}

export interface CcDashboardChartData {
  monthlyTrend: { name: string; count: number }[];
  byDepartment: { name: string; count: number }[];
  byType: { name: string; count: number }[];
  byCategory: { name: string; count: number }[];
  byPriority: { name: string; count: number }[];
  openVsClosedTrend: { name: string; open: number; closed: number }[];
  validationImpactTrend: { name: string; count: number }[];
  trainingImpactTrend: { name: string; count: number }[];
  regulatoryImpactTrend: { name: string; count: number }[];
  overdueTrend: { name: string; count: number }[];
}

export interface CcDashboardTableRow {
  id: string;
  change_number: string;
  change_date: string;
  change_title: string;
  department: string;
  change_type: string;
  change_category: string;
  change_priority: string;
  status: string;
  owner: string;
  due_date: string;
  days_overdue: number;
  validation_impact: boolean;
  csv_impact: boolean;
  regulatory_impact: boolean;
  risk_level: string;
}

export interface CcDashboardActivityEntry {
  action: string;
  user: string;
  at: string;
  detail?: string;
  recordId?: string;
}

export interface CcDashboardData {
  metrics: CcDashboardMetrics;
  charts: CcDashboardChartData;
  recentChanges: CcDashboardTableRow[];
  overdueChanges: CcDashboardTableRow[];
  criticalChanges: CcDashboardTableRow[];
  activity: CcDashboardActivityEntry[];
  departments: string[];
  filteredCount: number;
}

const TERMINAL_STATUSES = new Set(['closed', 'rejected', 'cancelled']);

export function isCcOpen(status: string): boolean {
  return !TERMINAL_STATUSES.has(status);
}

function ccDueDate(r: ChangeControlRecord): string {
  return r.target_closure_date || r.planned_implementation_date || '';
}

export function isRecordOverdue(r: ChangeControlRecord, today = localCalendarDate()): boolean {
  if (!isCcOpen(r.status) || r.status === 'overdue') return r.status === 'overdue';
  const due = ccDueDate(r);
  if (!due) return false;
  return due < today;
}

export function daysOverdue(r: ChangeControlRecord, today = localCalendarDate()): number {
  if (!isRecordOverdue(r, today) && r.status !== 'overdue') return 0;
  const due = ccDueDate(r);
  if (!due) return 0;
  const diff = new Date(`${today}T00:00:00`).getTime() - new Date(`${due}T00:00:00`).getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function getRiskLevelForChange(
  record: ChangeControlRecord,
  riskMap: Map<string, ChangeRiskAssessment>,
): string {
  if (record.overall_risk_level) return record.overall_risk_level;
  const risk = riskMap.get(record.id);
  return risk?.risk_level || '—';
}

export function toDashboardRow(
  r: ChangeControlRecord,
  riskMap: Map<string, ChangeRiskAssessment> = new Map(),
): CcDashboardTableRow {
  return {
    id: r.id,
    change_number: r.change_control_number || '—',
    change_date: r.change_date || '—',
    change_title: r.change_title || '—',
    department: r.department || '—',
    change_type: r.change_type || '—',
    change_category: r.change_category || '—',
    change_priority: r.change_priority || '—',
    status: r.status || 'draft',
    owner: r.assigned_owner_name || r.assigned_owner || r.initiated_by_name || '—',
    due_date: ccDueDate(r) || '—',
    days_overdue: daysOverdue(r),
    validation_impact: !!r.validation_impact,
    csv_impact: !!r.csv_impact,
    regulatory_impact: !!r.regulatory_impact,
    risk_level: getRiskLevelForChange(r, riskMap),
  };
}

function inDateRange(dateStr: string | undefined | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!dateStr) return !from && !to;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  if (from && d < new Date(from)) return false;
  if (to && d > new Date(`${to}T23:59:59`)) return false;
  return true;
}

export function applyKpiFilter(records: ChangeControlRecord[], filter: CcDashboardKpiFilter): ChangeControlRecord[] {
  switch (filter) {
    case 'open': return records.filter((r) => isCcOpen(r.status));
    case 'closed': return records.filter((r) => r.status === 'closed');
    case 'draft': return records.filter((r) => r.status === 'draft');
    case 'under_qa_review': return records.filter((r) => r.status === 'under_qa_review' || r.status === 'submitted');
    case 'impact_assessment': return records.filter((r) => r.status === 'impact_assessment');
    case 'risk_assessment': return records.filter((r) => r.status === 'risk_assessment');
    case 'implementation_in_progress': return records.filter((r) => r.status === 'implementation_in_progress' || r.status === 'approved_for_implementation');
    case 'effectiveness_pending': return records.filter((r) => r.status === 'effectiveness_pending');
    case 'overdue': return records.filter((r) => isRecordOverdue(r) || r.status === 'overdue');
    case 'critical': return records.filter((r) => r.change_category === 'Critical');
    case 'validation_impact': return records.filter((r) => r.validation_impact);
    case 'csv_impact': return records.filter((r) => r.csv_impact);
    case 'training_impact': return records.filter((r) => r.training_impact);
    case 'regulatory_impact': return records.filter((r) => r.regulatory_impact);
    case 'capa_linked': return records.filter((r) => !!(r.linked_capa_number || r.linked_capa_id));
    default: return records;
  }
}

export function applyCcDashboardFilters(
  records: ChangeControlRecord[],
  filters: CcDashboardFilters,
): ChangeControlRecord[] {
  let results = applyKpiFilter(records, filters.kpi_filter);

  if (filters.department && filters.department !== 'All') {
    results = results.filter((r) => r.department === filters.department);
  }
  if (filters.change_type && filters.change_type !== 'All') {
    results = results.filter((r) => r.change_type === filters.change_type);
  }
  if (filters.change_category && filters.change_category !== 'All') {
    results = results.filter((r) => r.change_category === filters.change_category);
  }
  if (filters.change_priority && filters.change_priority !== 'All') {
    results = results.filter((r) => r.change_priority === filters.change_priority);
  }
  if (filters.date_from || filters.date_to) {
    results = results.filter((r) => inDateRange(r.change_date || r.created_at, filters.date_from, filters.date_to));
  }
  return results;
}

export function computeCcDashboardMetrics(records: ChangeControlRecord[]): CcDashboardMetrics {
  const closedRecords = records.filter((r) => r.status === 'closed');
  let closureDaysSum = 0;
  let closureCount = 0;
  closedRecords.forEach((r) => {
    const start = r.change_date || r.created_at?.slice(0, 10);
    const end = r.target_closure_date || r.updated_at?.slice(0, 10);
    if (start && end) {
      const diff = new Date(end).getTime() - new Date(start).getTime();
      if (!Number.isNaN(diff) && diff >= 0) {
        closureDaysSum += Math.ceil(diff / (1000 * 60 * 60 * 24));
        closureCount++;
      }
    }
  });

  return {
    total: records.length,
    open: records.filter((r) => isCcOpen(r.status)).length,
    closed: closedRecords.length,
    draft: records.filter((r) => r.status === 'draft').length,
    underQaReview: records.filter((r) => r.status === 'under_qa_review' || r.status === 'submitted').length,
    impactAssessmentPending: records.filter((r) => r.status === 'impact_assessment').length,
    riskAssessmentPending: records.filter((r) => r.status === 'risk_assessment').length,
    implementationInProgress: records.filter((r) => ['implementation_in_progress', 'approved_for_implementation'].includes(r.status)).length,
    effectivenessPending: records.filter((r) => r.status === 'effectiveness_pending').length,
    overdue: records.filter((r) => isRecordOverdue(r) || r.status === 'overdue').length,
    critical: records.filter((r) => r.change_category === 'Critical').length,
    validationImpact: records.filter((r) => r.validation_impact).length,
    csvImpact: records.filter((r) => r.csv_impact).length,
    trainingImpact: records.filter((r) => r.training_impact).length,
    regulatoryImpact: records.filter((r) => r.regulatory_impact).length,
    capaLinked: records.filter((r) => !!(r.linked_capa_number || r.linked_capa_id)).length,
    averageClosureDays: closureCount ? Math.round(closureDaysSum / closureCount) : 0,
  };
}

function monthKey(dateStr?: string | null): string {
  if (!dateStr) return '';
  return dateStr.slice(0, 7);
}

function countByMonth(
  records: ChangeControlRecord[],
  predicate: (r: ChangeControlRecord) => boolean,
): { name: string; count: number }[] {
  const map = new Map<string, number>();
  records.filter(predicate).forEach((r) => {
    const key = monthKey(r.change_date || r.created_at);
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function countMap(records: ChangeControlRecord[], getter: (r: ChangeControlRecord) => string): { name: string; count: number }[] {
  const map = new Map<string, number>();
  records.forEach((r) => {
    const key = getter(r) || 'Unknown';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
}

export function buildCcDashboardCharts(records: ChangeControlRecord[]): CcDashboardChartData {
  const months = new Set<string>();
  records.forEach((r) => {
    const m = monthKey(r.change_date || r.created_at);
    if (m) months.add(m);
  });
  const sortedMonths = Array.from(months).sort();

  const openVsClosedTrend = sortedMonths.map((name) => ({
    name,
    open: records.filter((r) => monthKey(r.change_date || r.created_at) === name && isCcOpen(r.status)).length,
    closed: records.filter((r) => monthKey(r.change_date || r.created_at) === name && r.status === 'closed').length,
  }));

  return {
    monthlyTrend: countByMonth(records, () => true),
    byDepartment: countMap(records, (r) => r.department),
    byType: countMap(records, (r) => r.change_type),
    byCategory: countMap(records, (r) => r.change_category),
    byPriority: countMap(records, (r) => r.change_priority),
    openVsClosedTrend,
    validationImpactTrend: countByMonth(records, (r) => r.validation_impact),
    trainingImpactTrend: countByMonth(records, (r) => r.training_impact),
    regulatoryImpactTrend: countByMonth(records, (r) => r.regulatory_impact),
    overdueTrend: countByMonth(records, (r) => isRecordOverdue(r) || r.status === 'overdue'),
  };
}

export function filterRecordsForRole(
  records: ChangeControlRecord[],
  role?: string | null,
  department?: string,
  userId?: string,
): ChangeControlRecord[] {
  const r = normalizeRole(role || '');
  const raw = (role || '').toLowerCase();

  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'auditor', 'viewer'].includes(r)) {
    return records;
  }
  if (raw.includes('regulatory')) {
    return records.filter((rec) => rec.regulatory_impact || rec.department === 'Regulatory');
  }
  if (raw.includes('csv') || raw.includes('it')) {
    return records.filter((rec) => rec.csv_impact || String(rec.change_type).includes('CSV') || rec.department === 'IT / CSV');
  }
  if (raw.includes('engineering')) {
    return records.filter((rec) => ['Equipment Change', 'Utility Change', 'Facility Change'].includes(String(rec.change_type)) || rec.department === 'Engineering');
  }
  if (raw.includes('qc')) {
    return records.filter((rec) => ['Specification Change', 'Method Change'].includes(String(rec.change_type)) || rec.department === 'QC');
  }
  if (raw.includes('production')) {
    return records.filter((rec) => rec.change_type === 'Process Change' || rec.department === 'Production');
  }
  if (raw.includes('warehouse')) {
    return records.filter((rec) => ['Raw Material Change', 'Packing Material Change', 'Vendor Change'].includes(String(rec.change_type)) || rec.department === 'Warehouse');
  }
  if (raw.includes('department_head') && department) {
    return records.filter((rec) => rec.department === department);
  }
  if (userId) {
    return records.filter((rec) => rec.created_by === userId || rec.initiated_by === userId || rec.assigned_owner === userId);
  }
  return records;
}

export function canViewCcDashboard(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  const raw = (role || '').toLowerCase();
  if (!role) return false;
  if (['auditor', 'viewer'].includes(r)) return true;
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive',
    'qc_manager', 'production_manager', 'engineering_manager', 'warehouse_manager', 'regulatory_affairs',
  ].includes(r)
    || raw.includes('production') || raw.includes('engineering') || raw.includes('qc')
    || raw.includes('warehouse') || raw.includes('regulatory') || raw.includes('csv')
    || raw.includes('department');
}

export function canExportCcDashboard(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive'].includes(r);
}

export function isCcDashboardReadOnly(role?: string | null): boolean {
  return ['auditor', 'viewer'].includes(normalizeRole(role || ''));
}

export function riskLevelBadgeClass(level: string): string {
  const map: Record<string, string> = {
    Critical: 'bg-red-100 text-red-800 border-red-300',
    High: 'bg-orange-100 text-orange-800 border-orange-300',
    Medium: 'bg-amber-100 text-amber-800 border-amber-300',
    Low: 'bg-green-100 text-green-800 border-green-300',
  };
  return map[level] || 'bg-slate-100 text-slate-700 border-slate-300';
}

export { CHANGE_TYPES, CHANGE_CATEGORIES, CHANGE_PRIORITIES, CC_DEPARTMENTS, isCcClosed };

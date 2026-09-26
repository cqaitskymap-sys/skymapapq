import { calculateCapability, type CppRecord, type CqaRecord, type RiskRecord, type CpvStatus } from './cpv';

export interface CpvDashboardFilters {
  product?: string;
  year?: string;
  month?: string;
  quarter?: string;
  batchNo?: string;
  riskLevel?: string;
  status?: string;
}

type DatedRecord = {
  productName?: string;
  batchNo?: string;
  manufacturingDate?: string;
  createdAt?: string;
  status?: CpvStatus | string;
};

function getRecordDate(record: DatedRecord): Date | null {
  const raw = record.manufacturingDate || record.createdAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function matchesQuarter(month: number, quarter: string): boolean {
  const q = parseInt(quarter.replace(/\D/g, ''), 10);
  if (!q || q < 1 || q > 4) return true;
  const start = (q - 1) * 3 + 1;
  return month >= start && month <= start + 2;
}

function matchesBatch(record: DatedRecord & { batchNo?: string }, batchNo?: string): boolean {
  if (!batchNo || batchNo === 'all') return true;
  return record.batchNo === batchNo;
}

function matchesStatus(record: { status?: string }, status?: string): boolean {
  if (!status || status === 'all') return true;
  return String(record.status || '').toLowerCase() === status.toLowerCase();
}

export function filterCpvRecords<T extends DatedRecord>(records: T[], filters: CpvDashboardFilters): T[] {
  return records.filter((record) => {
    if (filters.product && filters.product !== 'all' && record.productName !== filters.product) return false;
    if (!matchesBatch(record as DatedRecord & { batchNo?: string }, filters.batchNo)) return false;
    if (!matchesStatus(record as { status?: string }, filters.status)) return false;
    const date = getRecordDate(record);
    if (!date && (filters.year || filters.month || filters.quarter)) return false;
    if (date) {
      if (filters.year && filters.year !== 'all' && String(date.getFullYear()) !== filters.year) return false;
      if (filters.month && filters.month !== 'all' && String(date.getMonth() + 1).padStart(2, '0') !== filters.month) return false;
      if (filters.quarter && filters.quarter !== 'all' && !matchesQuarter(date.getMonth() + 1, filters.quarter)) return false;
    }
    return true;
  });
}

export function filterRiskRecords(records: RiskRecord[], filters: CpvDashboardFilters): RiskRecord[] {
  return records.filter((record) => {
    if (filters.product && filters.product !== 'all' && record.productName !== filters.product) return false;
    if (filters.riskLevel && filters.riskLevel !== 'all' && record.riskLevel !== filters.riskLevel) return false;
    if (!matchesBatch(record, filters.batchNo)) return false;
    const date = getRecordDate(record);
    if (date) {
      if (filters.year && filters.year !== 'all' && String(date.getFullYear()) !== filters.year) return false;
      if (filters.month && filters.month !== 'all' && String(date.getMonth() + 1).padStart(2, '0') !== filters.month) return false;
      if (filters.quarter && filters.quarter !== 'all' && !matchesQuarter(date.getMonth() + 1, filters.quarter)) return false;
    }
    return true;
  });
}

export function uniqueProducts(cpp: CppRecord[], cqa: CqaRecord[]): string[] {
  const set = new Set<string>();
  cpp.forEach((r) => r.productName && set.add(r.productName));
  cqa.forEach((r) => r.productName && set.add(r.productName));
  return Array.from(set).sort();
}

export function uniqueBatches(cpp: CppRecord[], cqa: CqaRecord[], batches: Record<string, unknown>[]): number {
  const set = new Set<string>();
  cpp.forEach((r) => r.batchNo && set.add(r.batchNo));
  cqa.forEach((r) => r.batchNo && set.add(r.batchNo));
  batches.forEach((b) => {
    const bn = String(b.batch_number || b.batchNo || b.batchNumber || '');
    if (bn) set.add(bn);
  });
  return set.size;
}

export function countByStatus(records: Array<{ status?: string }>) {
  return {
    complies: records.filter((r) => r.status === 'Complies').length,
    oot: records.filter((r) => r.status === 'OOT').length,
    oos: records.filter((r) => r.status === 'OOS').length,
  };
}

export function computeCapabilityAverages(cpp: CppRecord[], cqa: CqaRecord[]) {
  const grouped = new Map<string, number[]>();
  const limits = new Map<string, { lsl: number; usl: number }>();

  const add = (key: string, value: number, lsl: number, usl: number) => {
    grouped.set(key, [...(grouped.get(key) || []), value]);
    limits.set(key, { lsl, usl });
  };

  cpp.forEach((r) => add(`${r.productName}|${r.parameterName}`, r.observedValue, r.lsl, r.usl));
  cqa.forEach((r) => add(`${r.productName}|${r.testParameter}`, r.observedValue, r.lsl, r.usl));

  const results = Array.from(grouped.entries())
    .filter(([, values]) => values.length >= 2)
    .map(([key, values]) => {
      const { lsl, usl } = limits.get(key)!;
      return calculateCapability(values, lsl, usl);
    });

  const avg = (field: 'cpk' | 'ppk') =>
    results.length ? results.reduce((s, r) => s + r[field], 0) / results.length : 0;

  return { averageCpk: avg('cpk'), averagePpk: avg('ppk'), capabilityCount: results.length };
}

export function monthlyTrend(records: DatedRecord[]) {
  const map = new Map<string, number>();
  records.forEach((r) => {
    const d = getRecordDate(r);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function complianceTrend(records: DatedRecord[]) {
  const map = new Map<string, { total: number; complies: number }>();
  records.forEach((r) => {
    const d = getRecordDate(r);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const entry = map.get(key) || { total: 0, complies: 0 };
    entry.total += 1;
    if (r.status === 'Complies') entry.complies += 1;
    map.set(key, entry);
  });
  return Array.from(map.entries())
    .map(([month, v]) => ({ month, rate: v.total ? Math.round((v.complies / v.total) * 100) : 0, total: v.total }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function riskTrend(records: RiskRecord[]) {
  const map = new Map<string, { count: number; totalRpn: number }>();
  records.forEach((r) => {
    const d = getRecordDate(r);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const entry = map.get(key) || { count: 0, totalRpn: 0 };
    entry.count += 1;
    entry.totalRpn += r.rpn || 0;
    map.set(key, entry);
  });
  return Array.from(map.entries())
    .map(([month, v]) => ({ month, count: v.count, avgRpn: v.count ? Math.round(v.totalRpn / v.count) : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function productCompliance(cpp: CppRecord[], cqa: CqaRecord[]) {
  const map = new Map<string, { total: number; complies: number }>();
  [...cpp, ...cqa].forEach((r) => {
    const entry = map.get(r.productName) || { total: 0, complies: 0 };
    entry.total += 1;
    if (r.status === 'Complies') entry.complies += 1;
    map.set(r.productName, entry);
  });
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, rate: v.total ? Math.round((v.complies / v.total) * 100) : 0, total: v.total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}

export function openRiskCount(risks: RiskRecord[]): number {
  return risks.filter((r) => {
    const st = String(r.status || '').toLowerCase();
    return st !== 'closed' && st !== 'close';
  }).length;
}

export function highRiskCount(risks: RiskRecord[]): number {
  return risks.filter((r) => r.riskLevel === 'High' || r.riskLevel === 'Critical').length;
}

export function compliancePercent(complies: number, total: number): number {
  return total > 0 ? Math.round((complies / total) * 100) : 0;
}

export function ootOosMonthlyTrend(cpp: CppRecord[], cqa: CqaRecord[]) {
  const map = new Map<string, { oot: number; oos: number }>();
  const add = (r: { status?: string; manufacturingDate?: string; createdAt?: string }) => {
    const d = getRecordDate(r);
    if (!d || r.status !== 'OOT' && r.status !== 'OOS') return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const entry = map.get(key) || { oot: 0, oos: 0 };
    if (r.status === 'OOT') entry.oot += 1;
    if (r.status === 'OOS') entry.oos += 1;
    map.set(key, entry);
  };
  cpp.forEach(add);
  cqa.forEach(add);
  return Array.from(map.entries())
    .map(([month, v]) => ({ month, oot: v.oot, oos: v.oos }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function riskLevelDistribution(risks: RiskRecord[]) {
  const levels = ['Low', 'Medium', 'High', 'Critical'] as const;
  return levels.map((level) => ({
    name: level,
    value: risks.filter((r) => r.riskLevel === level).length,
  })).filter((x) => x.value > 0);
}

export function cpkMonthlyTrend(capability: Array<{ cpk?: number; createdAt?: string; date?: string }>) {
  const map = new Map<string, { sum: number; count: number }>();
  capability.forEach((r) => {
    const cpk = Number(r.cpk);
    if (!Number.isFinite(cpk)) return;
    const raw = r.createdAt || r.date;
    if (!raw) return;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const entry = map.get(key) || { sum: 0, count: 0 };
    entry.sum += cpk;
    entry.count += 1;
    map.set(key, entry);
  });
  return Array.from(map.entries())
    .map(([month, v]) => ({ month, cpk: v.count ? Number((v.sum / v.count).toFixed(2)) : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function batchReviewTrend(records: DatedRecord[]) {
  const map = new Map<string, Set<string>>();
  records.forEach((r) => {
    const d = getRecordDate(r);
    const batch = (r as { batchNo?: string }).batchNo;
    if (!d || !batch) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const set = map.get(key) || new Set<string>();
    set.add(batch);
    map.set(key, set);
  });
  return Array.from(map.entries())
    .map(([month, batches]) => ({ month, batches: batches.size }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export interface OotOosAlert {
  id?: string;
  type: 'CPP' | 'CQA';
  productName: string;
  batchNo: string;
  parameter: string;
  status: string;
  observedValue: number;
  unit: string;
  date: string;
}

export function buildOotOosAlerts(cpp: CppRecord[], cqa: CqaRecord[]): OotOosAlert[] {
  const alerts: OotOosAlert[] = [];
  cpp.filter((r) => r.status === 'OOT' || r.status === 'OOS').forEach((r) => {
    alerts.push({
      id: r.id, type: 'CPP', productName: r.productName, batchNo: r.batchNo,
      parameter: r.parameterName, status: r.status, observedValue: r.observedValue,
      unit: r.unit, date: r.manufacturingDate || r.createdAt || '',
    });
  });
  cqa.filter((r) => r.status === 'OOT' || r.status === 'OOS').forEach((r) => {
    alerts.push({
      id: r.id, type: 'CQA', productName: r.productName, batchNo: r.batchNo,
      parameter: r.testParameter, status: r.status, observedValue: r.observedValue,
      unit: r.unit, date: r.createdAt || '',
    });
  });
  return alerts.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 20);
}

export interface CpvActivity {
  id?: string;
  timestamp: string;
  action: string;
  module: string;
  actorName: string;
  recordId: string;
}

export function mapAuditToActivities(audit: Record<string, unknown>[]): CpvActivity[] {
  return audit.map((a) => ({
    id: a.id as string,
    timestamp: String(a.timestamp || a.dateTime || a.createdAt || ''),
    action: String(a.action || a.actionType || ''),
    module: String(a.module || a.moduleName || ''),
    actorName: String(a.actorName || a.changedByUserName || a.userName || 'System'),
    recordId: String(a.recordId || a.documentId || ''),
  })).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 25);
}

export function availableYears(records: DatedRecord[]): string[] {
  const years = new Set<string>();
  records.forEach((r) => {
    const d = getRecordDate(r);
    if (d) years.add(String(d.getFullYear()));
  });
  return Array.from(years).sort((a, b) => b.localeCompare(a));
}

/** Filter generic Firestore rows that share product/batch/date fields with CPV records. */
export function filterGenericCpvRows(
  rows: Record<string, unknown>[],
  filters: CpvDashboardFilters,
): Record<string, unknown>[] {
  return rows.filter((row) => {
    if (row.isDeleted === true || row.is_deleted === true) return false;
    const productName = String(row.productName || row.product_name || row.product || '');
    const batchNo = String(row.batchNo || row.batch_no || row.batch_number || row.batchNumber || '');
    const status = String(row.status || '');
    if (filters.product && filters.product !== 'all' && productName !== filters.product) return false;
    if (filters.batchNo && filters.batchNo !== 'all' && batchNo !== filters.batchNo) return false;
    if (filters.status && filters.status !== 'all' && status.toLowerCase() !== filters.status.toLowerCase()) return false;
    if (filters.riskLevel && filters.riskLevel !== 'all') {
      const risk = String(row.riskLevel || row.risk_level || '');
      if (risk !== filters.riskLevel) return false;
    }
    const dated = {
      manufacturingDate: String(row.manufacturingDate || row.manufacturing_date || row.testDate || row.test_date || ''),
      createdAt: String(row.createdAt || row.created_at || ''),
    };
    const date = getRecordDate(dated);
    if (!date && (filters.year || filters.month || filters.quarter)
      && filters.year !== 'all' && filters.month !== 'all' && filters.quarter !== 'all') {
      // Allow undated rows when only soft filters set
    }
    if (date) {
      if (filters.year && filters.year !== 'all' && String(date.getFullYear()) !== filters.year) return false;
      if (filters.month && filters.month !== 'all' && String(date.getMonth() + 1).padStart(2, '0') !== filters.month) return false;
      if (filters.quarter && filters.quarter !== 'all' && !matchesQuarter(date.getMonth() + 1, filters.quarter)) return false;
    }
    return true;
  });
}

export function computeProcessHealthScore(input: {
  cppCompliancePct: number;
  cqaCompliancePct: number;
  openHighRisks: number;
  oosCount: number;
  spcOutOfControl: number;
  holdExceeded: number;
  avgCpk: number;
}): number {
  let score = Math.round((input.cppCompliancePct * 0.35) + (input.cqaCompliancePct * 0.35));
  if (input.avgCpk >= 1.33) score += 15;
  else if (input.avgCpk >= 1.0) score += 8;
  else if (input.avgCpk > 0) score -= 5;
  score -= Math.min(20, input.openHighRisks * 3);
  score -= Math.min(15, input.oosCount * 2);
  score -= Math.min(10, input.spcOutOfControl * 2);
  score -= Math.min(10, input.holdExceeded * 2);
  return Math.max(0, Math.min(100, score));
}

/** Approximate sigma level from average Cpk (enterprise dashboard indicator). */
export function sigmaFromCpk(cpk: number): number {
  if (!Number.isFinite(cpk) || cpk <= 0) return 0;
  return Math.round(cpk * 3 * 100) / 100;
}

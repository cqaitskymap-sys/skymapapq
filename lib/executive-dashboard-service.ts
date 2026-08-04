import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { computeExtendedCapaDashboardMetrics } from '@/lib/capa-dashboard-records';
import { listCapas } from '@/lib/capa-service';
import { fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { fetchCpvAlerts } from '@/lib/cpv-alert-service';
import { fetchYieldRecords } from '@/lib/cpv-yield-monitoring-service';
import { computeExtendedDashboardMetrics } from '@/lib/deviation-dashboard-metrics';
import { listDeviations } from '@/lib/deviation-service';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { computeExtendedOosDashboardMetrics } from '@/lib/oos-dashboard-records';
import { listOosRecords } from '@/lib/oos-service';
import { isCapaClosed } from '@/lib/capa-types';
import { isOpenStatus, type DeviationRecord } from '@/lib/deviation-types';
import type { CpvBatchRecord } from '@/lib/cpv-batch-registration';
import type { CpvAlertRecord } from '@/lib/cpv-alert-records';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEVIATION_COLORS: Record<string, string> = { Minor: '#3B82F6', Major: '#F59E0B', Critical: '#EF4444' };
const CAPA_GROUP_COLORS: Record<string, string> = {
  Open: '#3B82F6',
  'In Progress': '#F59E0B',
  Verification: '#8B5CF6',
  Closed: '#10B981',
};

export interface ExecutiveDashboardKpis {
  totalBatches: number;
  batchesMTD: number;
  releaseRate: number;
  releaseRateTrend: string | null;
  avgYield: number;
  openDeviations: number;
  criticalDeviations: number;
  openOos: number;
  openCapa: number;
  closedCapaYtd: number;
  complianceScore: number;
}

export interface ExecutiveDashboardBatchRow {
  id: string;
  batch_number: string;
  product_name: string;
  status: string;
  yield_percentage: number | null;
}

export interface ExecutiveDashboardDeviationRow {
  id: string;
  deviation_number: string;
  title: string;
  deviation_type: string;
  status: string;
}

export interface ExecutiveDashboardAlertRow {
  id: string;
  type: 'warning' | 'error' | 'info' | 'success';
  title: string;
  description: string;
  module: string;
}

export interface ExecutiveDashboardData {
  kpis: ExecutiveDashboardKpis;
  batchTrend: Array<{ month: string; released: number; rejected: number; inProcess: number }>;
  yieldTrend: Array<{ month: string; yield: number }>;
  oosTrend: Array<{ month: string; count: number }>;
  deviationsByType: Array<{ name: string; value: number; color: string }>;
  capaStatus: Array<{ name: string; value: number; color: string }>;
  complianceScores: Array<{ module: string; score: number }>;
  recentBatches: ExecutiveDashboardBatchRow[];
  recentDeviations: ExecutiveDashboardDeviationRow[];
  alerts: ExecutiveDashboardAlertRow[];
  error?: string;
}

function emptyData(error?: string): ExecutiveDashboardData {
  return {
    kpis: {
      totalBatches: 0,
      batchesMTD: 0,
      releaseRate: 0,
      releaseRateTrend: null,
      avgYield: 0,
      openDeviations: 0,
      criticalDeviations: 0,
      openOos: 0,
      openCapa: 0,
      closedCapaYtd: 0,
      complianceScore: 0,
    },
    batchTrend: [],
    yieldTrend: [],
    oosTrend: [],
    deviationsByType: [],
    capaStatus: [],
    complianceScores: [],
    recentBatches: [],
    recentDeviations: [],
    alerts: [],
    error,
  };
}

function round(v: number, d = 1) {
  return Number(v.toFixed(d));
}

function pct(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return round((numerator / denominator) * 100);
}

function parseDate(raw?: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function batchDate(batch: CpvBatchRecord): Date | null {
  return parseDate(batch.manufacturingDate || batch.createdAt);
}

function isYtd(date: Date | null, year: number) {
  return Boolean(date && date.getFullYear() === year);
}

function isCurrentMonth(date: Date | null) {
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelFromKey(key: string): string {
  const [, m] = key.split('-');
  const idx = Number(m) - 1;
  return MONTH_LABELS[idx] ?? key;
}

function last12MonthKeys(): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(monthKey(d));
  }
  return keys;
}

function normalizeBatchStatus(batch: CpvBatchRecord): string {
  const status = (batch.batchStatus || batch.status || '').toLowerCase();
  if (status.includes('release')) return 'released';
  if (status.includes('reject')) return 'rejected';
  if (status.includes('manufactur') || status.includes('qc') || status.includes('qa') || status.includes('planned') || status.includes('hold')) {
    return 'in_process';
  }
  return status.replace(/\s+/g, '_') || 'unknown';
}

function mapCapaStatusGroup(status: string): string {
  if (isCapaClosed(status) || status === 'approved') return 'Closed';
  if (status === 'effectiveness_pending' || status === 'qa_review') return 'Verification';
  if (['assigned', 'under_implementation', 'implemented'].includes(status)) return 'In Progress';
  if (status === 'rejected') return 'Closed';
  return 'Open';
}

function mapAlertType(alert: CpvAlertRecord): ExecutiveDashboardAlertRow['type'] {
  const sev = (alert.alertSeverity || '').toLowerCase();
  if (sev.includes('critical')) return 'error';
  if (sev.includes('major') || sev.includes('warning')) return 'warning';
  if (sev.includes('information')) return 'info';
  return 'warning';
}

function buildAlerts(
  cpvAlerts: CpvAlertRecord[],
  deviations: DeviationRecord[],
  openOos: number,
  overdueCapa: number,
): ExecutiveDashboardAlertRow[] {
  const rows: ExecutiveDashboardAlertRow[] = cpvAlerts
    .filter((a) => !['Closed', 'Resolved'].includes(a.alertStatus))
    .slice(0, 4)
    .map((a) => ({
      id: a.id,
      type: mapAlertType(a),
      title: a.alertTitle || a.alertNumber,
      description: a.alertMessage,
      module: a.alertSource || 'CPV Alert Engine',
    }));

  const criticalDevs = deviations.filter((d) => d.criticality === 'Critical' && isOpenStatus(d.status));
  if (criticalDevs.length) {
    rows.push({
      id: `dev-critical-${criticalDevs[0].id}`,
      type: 'error',
      title: `${criticalDevs.length} critical deviation${criticalDevs.length > 1 ? 's' : ''} open`,
      description: criticalDevs[0].title,
      module: 'Deviation Management',
    });
  }

  if (openOos > 0) {
    rows.push({
      id: 'oos-open',
      type: 'warning',
      title: `${openOos} OOS investigation${openOos > 1 ? 's' : ''} open`,
      description: 'Review open out-of-specification records requiring investigation.',
      module: 'OOS Management',
    });
  }

  if (overdueCapa > 0) {
    rows.push({
      id: 'capa-overdue',
      type: 'warning',
      title: `${overdueCapa} overdue CAPA${overdueCapa > 1 ? 's' : ''}`,
      description: 'CAPA actions have passed their target completion date.',
      module: 'CAPA Management',
    });
  }

  return rows.slice(0, 6);
}

async function readLegacyBatches(max = 500): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), 'batches'),
      orderBy('createdAt', 'desc'),
      limit(max),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), 'batches'), limit(max)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      return [];
    }
  }
}

export async function fetchExecutiveDashboardData(): Promise<ExecutiveDashboardData> {
  if (!isFirebaseConfigured()) {
    return emptyData('Firebase is not configured. Connect your database to load live dashboard data.');
  }

  try {
    const year = new Date().getFullYear();
    const monthKeys = last12MonthKeys();

    const [
      cpvBatches,
      legacyBatches,
      deviations,
      oosRecords,
      capaRecords,
      yieldRecords,
      cpvAlerts,
    ] = await Promise.all([
      fetchCpvBatches().catch(() => [] as CpvBatchRecord[]),
      readLegacyBatches(),
      listDeviations().catch(() => []),
      listOosRecords().catch(() => []),
      listCapas().catch(() => []),
      fetchYieldRecords().catch(() => []),
      fetchCpvAlerts(50).catch(() => [] as CpvAlertRecord[]),
    ]);

    const batches = cpvBatches.length
      ? cpvBatches
      : legacyBatches.map((raw) => ({
          id: String(raw.id),
          batchNumber: String(raw.batchNumber || raw.batch_number || ''),
          productName: String(raw.productName || raw.product_name || 'Unknown'),
          batchStatus: String(raw.batchStatus || raw.batch_status || raw.status || 'Planned'),
          releaseStatus: String(raw.releaseStatus || raw.release_status || 'Pending'),
          manufacturingDate: String(raw.manufacturingDate || raw.manufacturing_date || raw.createdAt || ''),
          createdAt: String(raw.createdAt || raw.created_at || ''),
          status: String(raw.status || raw.batchStatus || ''),
        })) as CpvBatchRecord[];

    const ytdBatches = batches.filter((b) => isYtd(batchDate(b), year));
    const mtdBatches = batches.filter((b) => isCurrentMonth(batchDate(b)));
    const releasedYtd = ytdBatches.filter((b) =>
      ['Released', 'released'].includes(b.batchStatus) || String(b.releaseStatus).toLowerCase().includes('release'),
    ).length;
    const rejectedYtd = ytdBatches.filter((b) =>
      ['Rejected', 'rejected'].includes(b.batchStatus) || String(b.releaseStatus).toLowerCase().includes('reject'),
    ).length;
    const releaseRate = pct(releasedYtd, releasedYtd + rejectedYtd);

    const lastYearReleased = batches.filter((b) => {
      const d = batchDate(b);
      return d?.getFullYear() === year - 1
        && (['Released', 'released'].includes(b.batchStatus) || String(b.releaseStatus).toLowerCase().includes('release'));
    }).length;
    const thisYearReleased = releasedYtd;
    let releaseRateTrend: string | null = null;
    if (lastYearReleased > 0) {
      const delta = pct(thisYearReleased - lastYearReleased, lastYearReleased);
      releaseRateTrend = `${delta >= 0 ? '+' : ''}${delta}% vs last year`;
    }

    const yieldValues = yieldRecords
      .map((y) => y.yieldPercentage)
      .filter((v) => Number.isFinite(v) && v > 0);
    const avgYield = yieldValues.length
      ? round(yieldValues.reduce((a, b) => a + b, 0) / yieldValues.length)
      : 0;

    const deviationMetrics = computeExtendedDashboardMetrics(deviations);
    const oosMetrics = computeExtendedOosDashboardMetrics(oosRecords);
    const capaMetrics = computeExtendedCapaDashboardMetrics(capaRecords);
    const closedCapaYtd = capaRecords.filter((c) => {
      if (!isCapaClosed(c.capa_status)) return false;
      const d = parseDate(c.actual_completion_date || c.updated_at || c.capa_date);
      return isYtd(d, year);
    }).length;

    const batchTrendMap = new Map<string, { released: number; rejected: number; inProcess: number }>();
    monthKeys.forEach((k) => batchTrendMap.set(k, { released: 0, rejected: 0, inProcess: 0 }));

    batches.forEach((b) => {
      const d = batchDate(b);
      if (!d) return;
      const key = monthKey(d);
      if (!batchTrendMap.has(key)) return;
      const cur = batchTrendMap.get(key)!;
      const normalized = normalizeBatchStatus(b);
      if (normalized === 'released') cur.released += 1;
      else if (normalized === 'rejected') cur.rejected += 1;
      else cur.inProcess += 1;
    });

    const yieldTrendMap = new Map<string, number[]>();
    yieldRecords.forEach((y) => {
      const d = parseDate(y.manufacturingDate || y.createdAt);
      if (!d || !y.yieldPercentage) return;
      const key = monthKey(d);
      const list = yieldTrendMap.get(key) || [];
      list.push(y.yieldPercentage);
      yieldTrendMap.set(key, list);
    });

    const oosTrendMap = new Map<string, number>();
    oosRecords.forEach((r) => {
      const d = parseDate(r.oos_date || r.created_at);
      if (!d) return;
      const key = monthKey(d);
      oosTrendMap.set(key, (oosTrendMap.get(key) || 0) + 1);
    });

    const deviationsByType = ['Minor', 'Major', 'Critical'].map((name) => ({
      name,
      value: deviationMetrics.byCriticality.find((c) => c.name === name)?.count ?? 0,
      color: DEVIATION_COLORS[name],
    })).filter((d) => d.value > 0);

    const capaGroupMap = new Map<string, number>();
    capaRecords.forEach((c) => {
      const group = mapCapaStatusGroup(c.capa_status);
      capaGroupMap.set(group, (capaGroupMap.get(group) || 0) + 1);
    });
    const capaStatus = ['Open', 'In Progress', 'Verification', 'Closed']
      .map((name) => ({
        name,
        value: capaGroupMap.get(name) || 0,
        color: CAPA_GROUP_COLORS[name],
      }))
      .filter((c) => c.value > 0);

    const deviationClosure = pct(deviationMetrics.closed, deviationMetrics.total);
    const capaClosure = pct(capaMetrics.closed, capaMetrics.total);
    const oosClosure = pct(oosMetrics.closed, oosMetrics.total);

    const complianceScores = [
      { module: 'Batch Mfg', score: releaseRate },
      { module: 'QC Testing', score: oosClosure },
      { module: 'Deviation Mgmt', score: deviationClosure },
      { module: 'CAPA', score: capaClosure },
      { module: 'Stability', score: pct(
        yieldRecords.filter((y) => (y.status || '').toLowerCase().includes('comply')).length,
        yieldRecords.length || 1,
      ) },
      { module: 'Change Control', score: 0 },
      { module: 'Vendors', score: 0 },
    ].filter((m) => m.score > 0);

    const scoredModules = complianceScores.filter((m) => m.score > 0);
    const complianceScore = scoredModules.length
      ? round(scoredModules.reduce((s, m) => s + m.score, 0) / scoredModules.length)
      : 0;

    const yieldByBatch = new Map<string, number>();
    yieldRecords.forEach((y) => {
      if (y.batchNumber && y.yieldPercentage) yieldByBatch.set(y.batchNumber, y.yieldPercentage);
    });

    const recentBatches = [...batches]
      .sort((a, b) => (batchDate(b)?.getTime() || 0) - (batchDate(a)?.getTime() || 0))
      .slice(0, 5)
      .map((b) => ({
        id: b.id,
        batch_number: b.batchNumber,
        product_name: b.productName,
        status: normalizeBatchStatus(b),
        yield_percentage: yieldByBatch.get(b.batchNumber) ?? null,
      }));

    const recentDeviations = [...deviations]
      .sort((a, b) => (parseDate(b.deviation_date || b.created_at)?.getTime() || 0)
        - (parseDate(a.deviation_date || a.created_at)?.getTime() || 0))
      .slice(0, 5)
      .map((d) => ({
        id: d.id,
        deviation_number: d.deviation_number,
        title: d.title,
        deviation_type: d.criticality?.toLowerCase() || 'minor',
        status: d.status,
      }));

    const alerts = buildAlerts(cpvAlerts, deviations, oosMetrics.open, capaMetrics.overdue);

    return {
      kpis: {
        totalBatches: ytdBatches.length,
        batchesMTD: mtdBatches.length,
        releaseRate,
        releaseRateTrend,
        avgYield,
        openDeviations: deviationMetrics.open,
        criticalDeviations: deviationMetrics.critical,
        openOos: oosMetrics.open,
        openCapa: capaMetrics.open,
        closedCapaYtd,
        complianceScore,
      },
      batchTrend: monthKeys.map((key) => ({
        month: monthLabelFromKey(key),
        ...batchTrendMap.get(key)!,
      })),
      yieldTrend: monthKeys
        .map((key) => {
          const vals = yieldTrendMap.get(key) || [];
          if (!vals.length) return null;
          return {
            month: monthLabelFromKey(key),
            yield: round(vals.reduce((a, b) => a + b, 0) / vals.length),
          };
        })
        .filter(Boolean) as Array<{ month: string; yield: number }>,
      oosTrend: monthKeys.map((key) => ({
        month: monthLabelFromKey(key),
        count: oosTrendMap.get(key) || 0,
      })),
      deviationsByType,
      capaStatus,
      complianceScores,
      recentBatches,
      recentDeviations,
      alerts,
    };
  } catch (e) {
    console.error('fetchExecutiveDashboardData failed', e);
    return emptyData((e as Error).message || 'Failed to load dashboard data');
  }
}

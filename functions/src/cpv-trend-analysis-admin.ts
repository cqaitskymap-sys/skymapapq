/**
 * CPV Trend Analysis — privileged Cloud Functions.
 * Server-side trend/SPC/AI engine, dual audit, e-sign approve, CF-only writes.
 * Hardens the existing Trend Analysis module (collection: trend_analysis).
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';
import { withAiRecommendationOverride } from './ai-recommendation-override';

function initializeAdmin() {
  if (getApps().length === 0) initializeApp();
}

function requiredString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength = 500): string {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function requiredReason(value: unknown): string {
  const reason = requiredString(value, 'Change reason', 2000);
  if (reason.length < 5) {
    throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');
  }
  return reason;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function round(n: number, d = 3): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** d) / 10 ** d;
}

const COLLECTION = 'trend_analysis';
const MODULE = 'Trend Analysis';

const ENTER_ROLES = [
  'super_admin', 'admin', 'qc', 'qc_manager',
  'production', 'production_manager', 'engineering', 'engineering_manager',
];
const REVIEW_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const VIEWER_ROLES = [
  ...ENTER_ROLES, ...REVIEW_ROLES, 'viewer', 'auditor',
];

const TREND_TYPES = [
  'CPP Trend', 'CQA Trend', 'Yield Trend', 'Stability Trend',
  'Raw Material Trend', 'Packing Material Trend', 'Utility Trend',
  'Environmental Trend', 'Hold Time Trend', 'Combined Trend',
] as const;
const DATA_SOURCES = [
  'CPP Results', 'CQA Results', 'Yield Monitoring', 'Stability Monitoring',
  'Raw Material Monitoring', 'Packing Material Monitoring', 'Utility Monitoring',
  'Environmental Monitoring', 'Hold Time Monitoring',
] as const;
const PARAMETER_TYPES = [
  'CPP', 'CQA', 'Yield', 'Stability', 'Raw Material', 'Packing Material',
  'Utility', 'Environmental', 'Hold Time',
] as const;

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Trend Analysis view access required');
  }
}
function assertEnter(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ENTER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Trend Analysis entry access required');
  }
}
function assertReviewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !REVIEW_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'QA review/approve access required');
  }
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const snap = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = snap.data();
  return {
    firestore,
    actor,
    actorRole: String(actor?.role || ''),
    actorName: String(actor?.full_name || actor?.email || request.auth.uid),
    actorUid: request.auth.uid,
  };
}

function buildTrendId(productCode: string, parameterCode: string): string {
  return `TREND-${productCode}-${parameterCode}-${new Date().getFullYear()}`
    .replace(/\s+/g, '-').toUpperCase().slice(0, 80);
}

interface SourcePoint {
  batchNumber: string;
  value: number;
  date: string;
  lsl?: number;
  usl?: number;
  target?: number;
  alertLow?: number;
  alertHigh?: number;
  actionLow?: number;
  actionHigh?: number;
}

function detectTrendDirection(values: number[]): string {
  if (values.length < 3) return 'No Data';
  const n = values.length;
  const chunk = Math.max(1, Math.floor(n * 0.3));
  const first = values.slice(0, chunk);
  const last = values.slice(n - chunk);
  const firstMean = first.reduce((s, v) => s + v, 0) / first.length;
  const lastMean = last.reduce((s, v) => s + v, 0) / last.length;
  const overallMean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - overallMean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const range = Math.max(...values) - Math.min(...values);
  const allLastHigher = last.every((v) => v > firstMean);
  const allLastLower = last.every((v) => v < firstMean);
  if (lastMean > firstMean + sd * 0.25 && allLastHigher) return 'Increasing';
  if (lastMean < firstMean - sd * 0.25 && allLastLower) return 'Decreasing';
  if (sd <= range * 0.15 || sd < overallMean * 0.02) return 'Stable';
  return 'Fluctuating';
}

function isCriticalParameter(parameterName: string): boolean {
  const critical = ['Sterility', 'Assay', 'Bacterial Endotoxin', 'Fill Volume', 'pH', 'Endotoxin'];
  return critical.some((p) => parameterName.toLowerCase().includes(p.toLowerCase()));
}

function evaluatePointStatus(value: number, point: SourcePoint) {
  let isOOS = false;
  let isAction = false;
  let isAlert = false;
  if (Number.isFinite(point.lsl) && value < (point.lsl as number)) isOOS = true;
  if (Number.isFinite(point.usl) && value > (point.usl as number)) isOOS = true;
  if (!isOOS) {
    if (Number.isFinite(point.actionLow) && value < point.actionLow!) isAction = true;
    if (Number.isFinite(point.actionHigh) && value > point.actionHigh!) isAction = true;
    if (!isAction) {
      if (Number.isFinite(point.alertLow) && value < point.alertLow!) isAlert = true;
      if (Number.isFinite(point.alertHigh) && value > point.alertHigh!) isAlert = true;
    }
  }
  return { isOOS, isAlert, isAction };
}

function detectOOT(value: number, point: SourcePoint, direction: string, mean: number): boolean {
  if (!Number.isFinite(point.lsl) || !Number.isFinite(point.usl)) return false;
  const lslVal = point.lsl as number;
  const uslVal = point.usl as number;
  if (value < lslVal || value > uslVal) return false;
  const span = uslVal - lslVal;
  if (span <= 0) return false;
  const distToUpper = (uslVal - value) / span;
  const distToLower = (value - lslVal) / span;
  const nearLimit = distToUpper < 0.15 || distToLower < 0.15;
  const drifting = (direction === 'Increasing' && distToUpper < 0.25)
    || (direction === 'Decreasing' && distToLower < 0.25);
  return nearLimit && drifting && Math.abs(value - mean) > span * 0.2;
}

function linearRegression(values: number[]) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0, r2: 0 };
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumXX = 0; let sumYY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += values[i]; sumXY += i * values[i]; sumXX += i * i; sumYY += values[i] * values[i];
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const ssTot = sumYY - (sumY * sumY) / n;
  const ssRes = values.reduce((s, y, i) => s + (y - (intercept + slope * i)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));
  return { slope, intercept, r2 };
}

function calculateTrend(points: SourcePoint[], parameterName: string) {
  const sorted = points
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const values = sorted.map((p) => p.value);
  const batchCount = new Set(sorted.map((p) => p.batchNumber)).size;
  if (values.length < 3) {
    throw new HttpsError('failed-precondition', 'At least 3 numeric data points required for trend analysis');
  }

  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sortedVals = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 ? sortedVals[mid] : (sortedVals[mid - 1] + sortedVals[mid]) / 2;
  const freq = new Map<number, number>();
  sortedVals.forEach((v) => freq.set(v, (freq.get(v) || 0) + 1));
  let mode: number | null = null;
  let maxF = 1;
  freq.forEach((f, v) => { if (f > maxF) { maxF = f; mode = v; } });

  const min = sortedVals[0];
  const max = sortedVals[n - 1];
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const window = Math.min(5, n);
  const recent = values.slice(-window);
  const movingAverage = recent.reduce((s, v) => s + v, 0) / recent.length;
  const weightSum = recent.reduce((s, _, i) => s + (i + 1), 0);
  const weightedAverage = recent.reduce((s, v, i) => s + v * (i + 1), 0) / weightSum;
  const { slope, intercept, r2 } = linearRegression(values);
  const xs = values.map((_, i) => i);
  const xMean = (n - 1) / 2;
  const cov = values.reduce((s, y, i) => s + (xs[i] - xMean) * (y - mean), 0) / (n - 1 || 1);
  const xVar = xs.reduce((s, x) => s + (x - xMean) ** 2, 0) / (n - 1 || 1);
  const correlation = sd > 0 && xVar > 0 ? cov / (Math.sqrt(xVar) * sd) : 0;
  const direction = detectTrendDirection(values);
  const processDriftDetected = Math.abs(slope) > (sd || 1) * 0.05
    && (direction === 'Increasing' || direction === 'Decreasing');

  let oosCount = 0; let ootCount = 0; let alertCount = 0; let actionCount = 0;
  const chartData = sorted.map((p) => {
    const status = evaluatePointStatus(p.value, p);
    const isOOT = !status.isOOS && !status.isAction && detectOOT(p.value, p, direction, mean);
    if (status.isOOS) oosCount += 1;
    if (status.isAction) actionCount += 1;
    if (status.isAlert) alertCount += 1;
    if (isOOT) ootCount += 1;
    return {
      ...p,
      label: p.batchNumber || p.date.slice(0, 10),
      mean: round(mean),
      isOOS: status.isOOS,
      isOOT,
      isAlert: status.isAlert && !status.isOOS && !status.isAction,
      isAction: status.isAction,
    };
  });

  let outlierCount = 0;
  if (n >= 4) {
    const q1 = sortedVals[Math.floor(n * 0.25)];
    const q3 = sortedVals[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    outlierCount = sortedVals.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length;
  }

  const lslCandidates = sorted.map((p) => p.lsl).filter((v): v is number => Number.isFinite(v as number));
  const uslCandidates = sorted.map((p) => p.usl).filter((v): v is number => Number.isFinite(v as number));
  const lsl = lslCandidates.length ? Math.min(...lslCandidates) : NaN;
  const usl = uslCandidates.length ? Math.max(...uslCandidates) : NaN;
  let cp = 0; let cpk = 0; let pp = 0; let ppk = 0;
  if (Number.isFinite(lsl) && Number.isFinite(usl) && usl > lsl && sd > 0) {
    const mrs = values.slice(1).map((v, i) => Math.abs(v - values[i]));
    const mrBar = mrs.length ? mrs.reduce((s, v) => s + v, 0) / mrs.length : 0;
    const withinSd = mrBar > 0 ? mrBar / 1.128 : sd;
    cp = (usl - lsl) / (6 * withinSd);
    cpk = Math.min((usl - mean) / (3 * withinSd), (mean - lsl) / (3 * withinSd));
    pp = (usl - lsl) / (6 * sd);
    ppk = Math.min((usl - mean) / (3 * sd), (mean - lsl) / (3 * sd));
  }

  const ewma: number[] = [values[0]];
  for (let i = 1; i < n; i++) ewma.push(0.2 * values[i] + 0.8 * ewma[i - 1]);
  let sh = 0; let sl = 0;
  const k = sd * 0.5 || 0.5;
  let cusumHighLast = 0; let cusumLowLast = 0;
  values.forEach((v) => {
    sh = Math.max(0, sh + (v - mean) - k);
    sl = Math.max(0, sl + (mean - v) - k);
    cusumHighLast = sh;
    cusumLowLast = sl;
  });

  const forecastSeries = [1, 2, 3].map((h) => round(intercept + slope * (n - 1 + h)));
  const goldenSlice = sorted.slice(0, Math.max(1, Math.floor(n * 0.3)));
  const goldenIdx = goldenSlice.reduce((best, p, i) => (
    Math.abs(p.value - mean) < Math.abs(goldenSlice[best].value - mean) ? i : best
  ), 0);
  const golden = goldenSlice[goldenIdx];

  let trendStatus = 'Normal';
  if (oosCount > 0) trendStatus = 'OOS';
  else if (actionCount > 0) trendStatus = 'Action Required';
  else if (ootCount > 0) trendStatus = 'OOT';
  else if (alertCount > 0 || processDriftDetected) trendStatus = 'Alert';

  const critical = isCriticalParameter(parameterName);
  let riskLevel = 'Low';
  if (trendStatus === 'OOS') riskLevel = critical ? 'Critical' : 'High';
  else if (trendStatus === 'Action Required') riskLevel = 'High';
  else if (trendStatus === 'OOT') riskLevel = critical ? 'Critical' : 'Medium';
  else if (trendStatus === 'Alert') riskLevel = 'Medium';

  const capaSuggested = oosCount > 0 || (alertCount + ootCount) >= 2 || processDriftDetected;
  const deviationRequired = oosCount > 0 || trendStatus === 'Action Required';
  const qualityDegradation = processDriftDetected || ootCount > 0 || (cpk > 0 && cpk < 1.0);

  let healthScore = 100;
  if (oosCount) healthScore -= Math.min(40, oosCount * 15);
  if (ootCount) healthScore -= Math.min(25, ootCount * 8);
  if (alertCount) healthScore -= Math.min(15, alertCount * 3);
  if (processDriftDetected) healthScore -= 10;
  if (outlierCount) healthScore -= Math.min(10, outlierCount * 2);
  if (cpk > 0 && cpk < 1.33) healthScore -= 10;
  healthScore = Math.max(0, Math.min(100, healthScore));
  const confidenceScore = Math.max(20, Math.min(99, round(40 + Math.min(40, n * 2) + r2 * 20 - outlierCount * 2, 1)));

  const tips: string[] = [];
  if (oosCount > 0) tips.push(`${oosCount} OOS point(s) on ${parameterName} — initiate deviation investigation.`);
  if (ootCount > 0) tips.push(`${ootCount} OOT signal(s) — tighten monitoring.`);
  if (processDriftDetected) tips.push('Process drift detected — compare against golden batch.');
  if (direction === 'Increasing' || direction === 'Decreasing') {
    tips.push(`${direction} trend (slope ${round(slope, 4)}) — forecast risk of specification breach.`);
  }
  if (cpk > 0 && cpk < 1.33) tips.push(`Cpk ${round(cpk)} below pharma target (≥1.33).`);
  if (!tips.length) tips.push(`Trend ${trendStatus} with health score ${round(healthScore, 1)} — continue routine CPV monitoring.`);

  return {
    batchCount,
    dataPointsCount: n,
    mean: round(mean),
    median: round(median),
    mode: mode == null ? null : round(mode),
    minimumValue: round(min),
    maximumValue: round(max),
    range: round(max - min),
    variance: round(variance),
    standardDeviation: round(sd),
    movingAverage: round(movingAverage),
    weightedAverage: round(weightedAverage),
    rollingAverage: round(movingAverage),
    regressionSlope: round(slope, 6),
    regressionIntercept: round(intercept),
    regressionR2: round(r2, 4),
    correlation: round(correlation, 4),
    covariance: round(cov),
    zScoreMean: sd > 0 ? round((values[n - 1] - mean) / sd) : 0,
    sigmaLevel: cpk > 0 ? round(cpk * 3) : (sd > 0 ? round(Math.abs(mean) / sd) : 0),
    cp: round(cp),
    cpk: round(cpk),
    pp: round(pp),
    ppk: round(ppk),
    ucl: round(mean + 3 * sd),
    lcl: round(mean - 3 * sd),
    ewmaLast: round(ewma[ewma.length - 1] || mean),
    cusumHighLast: round(cusumHighLast),
    cusumLowLast: round(cusumLowLast),
    outlierCount,
    forecastNext: forecastSeries[0] || round(mean),
    forecastSeries,
    processDriftDetected,
    qualityDegradation,
    healthScore: round(healthScore, 1),
    confidenceScore,
    aiRecommendation: tips.join(' '),
    goldenBatchNumber: golden?.batchNumber || '',
    goldenBatchDelta: golden ? round(Math.abs(values[n - 1] - golden.value)) : 0,
    trendDirection: direction,
    trendStatus,
    riskLevel,
    ootCount,
    oosCount,
    alertCount,
    actionCount,
    capaSuggested,
    deviationRequired,
    chartData: chartData.slice(0, 100),
    sourcePreview: sorted.slice(0, 50),
  };
}

function writeAudit(
  batch: WriteBatch,
  firestore: Firestore,
  input: {
    actorUid: string; actorName: string; recordId: string; documentNumber?: string;
    actionType: string; description: string; oldValue?: unknown; newValue?: unknown;
    reason?: string; now: string; esign?: boolean;
  },
) {
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-TREND-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now, timestamp: input.now, moduleName: 'CPV', subModule: MODULE,
    collectionName: COLLECTION, recordId: input.recordId, documentId: input.recordId,
    documentNumber: input.documentNumber || '', actionType: input.actionType, action: input.actionType,
    actionDescription: input.description, oldValue: input.oldValue ?? null, newValue: input.newValue ?? null,
    reason: input.reason || '', performedBy: input.actorName, userId: input.actorUid, userName: input.actorName,
    electronicSignature: input.esign === true, createdAt: input.now, source: 'cpv-trend-analysis-admin',
    immutable: true, appendOnly: true,
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: MODULE, action: input.actionType, recordId: input.recordId, description: input.description,
    performedBy: input.actorName, userId: input.actorUid, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: 'cpv-trend-analysis-admin',
  });
  batch.set(firestore.collection('cpv_audit_trail').doc(), {
    moduleName: MODULE, actionType: input.actionType, actionDescription: input.description,
    recordId: input.recordId, documentNumber: input.documentNumber || '',
    userId: input.actorUid, userName: input.actorName, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: 'cpv-trend-analysis-admin',
  });
}

function notify(
  firestore: Firestore, batch: WriteBatch,
  input: { targetUid: string; recordId: string; eventName: string; title: string; message: string; now: string },
) {
  batch.set(firestore.collection('notifications').doc(), {
    userId: input.targetUid, title: input.title, message: input.message, type: 'cpv_trend_analysis',
    eventName: input.eventName, recordId: input.recordId, module: MODULE,
    href: `/cpv/trend-analysis/${input.recordId}`, read: false, createdAt: input.now,
  });
}

async function assertOperationalProduct(firestore: Firestore, productId: string) {
  const snap = await firestore.collection('cpv_products').doc(productId).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('failed-precondition', 'CPV product not found');
  }
  const status = String(snap.data()?.cpvStatus || '');
  if (!['Active', 'Under Review', 'Approved'].includes(status)) {
    throw new HttpsError('failed-precondition', 'Selected CPV product is not operational');
  }
}

function sanitizeMeta(data: Record<string, unknown>, existing?: DocumentData) {
  const parameterType = requiredString(data.parameterType ?? existing?.parameterType, 'Parameter type', 40);
  if (!PARAMETER_TYPES.includes(parameterType as typeof PARAMETER_TYPES[number])) {
    throw new HttpsError('invalid-argument', `Invalid parameter type: ${parameterType}`);
  }
  const dataSource = requiredString(data.dataSource ?? existing?.dataSource, 'Data source', 80);
  if (!DATA_SOURCES.includes(dataSource as typeof DATA_SOURCES[number])) {
    throw new HttpsError('invalid-argument', `Invalid data source: ${dataSource}`);
  }
  const trendType = requiredString(data.trendType ?? existing?.trendType, 'Trend type', 80);
  if (!TREND_TYPES.includes(trendType as typeof TREND_TYPES[number])) {
    throw new HttpsError('invalid-argument', `Invalid trend type: ${trendType}`);
  }
  const productCode = requiredString(data.productCode ?? existing?.productCode, 'Product code', 80);
  const parameterCode = requiredString(data.parameterCode ?? existing?.parameterCode, 'Parameter code', 80);
  const from = requiredString(data.reviewPeriodFrom ?? existing?.reviewPeriodFrom, 'Review period from', 40);
  const to = requiredString(data.reviewPeriodTo ?? existing?.reviewPeriodTo, 'Review period to', 40);
  if (new Date(to) <= new Date(from)) {
    throw new HttpsError('invalid-argument', 'Review period end must be after start');
  }
  return {
    recordType: 'trend_analysis',
    trendId: optionalString(data.trendId ?? existing?.trendId, 'Trend id', 80) || buildTrendId(productCode, parameterCode),
    cpvProductId: requiredString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),
    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    productCode,
    trendType,
    dataSource,
    parameterType,
    parameterCode,
    parameterName: requiredString(data.parameterName ?? existing?.parameterName, 'Parameter name', 200),
    reviewPeriodFrom: from,
    reviewPeriodTo: to,
    conclusion: optionalString(data.conclusion ?? existing?.conclusion, 'Conclusion', 2000),
    recommendation: optionalString(data.recommendation ?? existing?.recommendation, 'Recommendation', 2000),
    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),
  };
}

function parsePoints(data: Record<string, unknown>, existing?: DocumentData): SourcePoint[] {
  const raw = Array.isArray(data.points)
    ? data.points
    : (Array.isArray(existing?.sourcePreview) ? existing!.sourcePreview : []);
  if (!Array.isArray(raw) || raw.length < 3) {
    throw new HttpsError('failed-precondition', 'At least 3 numeric data points required for trend analysis');
  }
  if (raw.length > 5000) {
    throw new HttpsError('invalid-argument', 'Maximum 5000 points per analysis');
  }
  const points: SourcePoint[] = [];
  for (const item of raw) {
    const row = (item || {}) as Record<string, unknown>;
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    points.push({
      batchNumber: String(row.batchNumber || ''),
      value,
      date: String(row.date || new Date().toISOString()),
      lsl: optionalFiniteNumber(row.lsl),
      usl: optionalFiniteNumber(row.usl),
      target: optionalFiniteNumber(row.target),
      alertLow: optionalFiniteNumber(row.alertLow),
      alertHigh: optionalFiniteNumber(row.alertHigh),
      actionLow: optionalFiniteNumber(row.actionLow),
      actionHigh: optionalFiniteNumber(row.actionHigh),
    });
  }
  if (points.length < 3) {
    throw new HttpsError('failed-precondition', 'At least 3 numeric data points required for trend analysis');
  }
  return points;
}

function emitAlerts(
  firestore: Firestore, batch: WriteBatch, actorUid: string, recordId: string,
  meta: ReturnType<typeof sanitizeMeta>, calc: ReturnType<typeof calculateTrend>, now: string,
) {
  if (calc.trendStatus !== 'Normal') {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Trend Detected',
      title: `${calc.trendStatus} Trend`, message: `${meta.parameterName}: ${calc.trendDirection}`, now,
    });
  }
  if (calc.processDriftDetected) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Process Drift',
      title: 'Process Drift Detected', message: `${meta.parameterName} drifting`, now,
    });
  }
  if (calc.oosCount > 0) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'OOS Trend',
      title: 'OOS Trend Alert', message: `${meta.parameterName}: ${calc.oosCount} OOS`, now,
    });
  }
  if (calc.ootCount > 0) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'OOT Trend',
      title: 'OOT Trend Alert', message: `${meta.parameterName}: ${calc.ootCount} OOT`, now,
    });
  }
  if (calc.deviationRequired) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Deviation Created',
      title: 'Deviation Required', message: `${meta.parameterName}: ${calc.trendStatus}`, now,
    });
  }
  if (calc.capaSuggested) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'CAPA Created',
      title: 'CAPA Suggested', message: `${meta.parameterName}: ${calc.trendStatus}`, now,
    });
  }
  if (calc.forecastNext && calc.trendDirection !== 'Stable') {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Prediction Alert',
      title: 'Trend Forecast', message: `${meta.parameterName} next ≈ ${calc.forecastNext}`, now,
    });
  }
}

export const createAdminTrendAnalysis = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);
  await assertOperationalProduct(firestore, requiredString(data.cpvProductId, 'CPV product', 120));
  const meta = sanitizeMeta(data);
  const points = parsePoints(data);
  const calc = withAiRecommendationOverride(calculateTrend(points, meta.parameterName), data);
  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const record = {
    ...meta,
    ...calc,
    id: ref.id,
    linkedRiskId: '',
    linkedDeviationNumber: '',
    linkedCapaNumber: '',
    status: 'Generated' as const,
    isLocked: false,
    generatedBy: actorName,
    generatedDate: now.slice(0, 10),
    reviewedBy: '',
    reviewDate: '',
    approvedBy: '',
    approvalDate: '',
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdByName: actorName,
    updatedByName: actorName,
    isDeleted: false,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.set(ref, record);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: meta.trendId,
    actionType: 'Trend Created', description: `Created ${meta.trendId} ${calc.trendStatus}`,
    newValue: { trendStatus: calc.trendStatus, direction: calc.trendDirection }, reason, now,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: meta.trendId,
    actionType: 'Analysis Executed', description: `n=${calc.dataPointsCount} mean=${calc.mean} sd=${calc.standardDeviation}`,
    newValue: calc, reason, now,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: meta.trendId,
    actionType: 'AI Prediction Generated', description: calc.aiRecommendation.slice(0, 500),
    newValue: { healthScore: calc.healthScore, forecastNext: calc.forecastNext, confidenceScore: calc.confidenceScore },
    reason, now,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: meta.trendId,
    actionType: 'Forecast Generated', description: `Next ${calc.forecastSeries.join(', ')}`,
    newValue: { forecastSeries: calc.forecastSeries }, reason, now,
  });
  emitAlerts(firestore, batch, actorUid, ref.id, meta, calc, now);
  await batch.commit();
  return record;
});

export const regenerateAdminTrendAnalysis = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Trend analysis record not found');
  }
  const existing = snap.data() || {};
  if (existing.isLocked === true && existing.status === 'Approved') {
    if (!qaOverride) throw new HttpsError('failed-precondition', 'Approved record is locked. QA override required.');
    assertReviewer(actor, actorRole);
    if (data.esignConfirmed !== true) {
      throw new HttpsError('failed-precondition', 'Electronic signature required for QA override');
    }
  } else {
    assertEnter(actor, actorRole);
  }

  const meta = sanitizeMeta({ ...existing, ...data }, existing);
  const points = parsePoints(data, existing);
  const calc = withAiRecommendationOverride(calculateTrend(points, meta.parameterName), data);
  const now = new Date().toISOString();
  const updates = {
    ...meta,
    ...calc,
    status: 'Generated',
    isLocked: qaOverride ? false : existing.isLocked === true,
    generatedBy: actorName,
    generatedDate: now.slice(0, 10),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: meta.trendId,
    actionType: qaOverride ? 'Trend QA Override' : 'Trend Updated',
    description: `Regenerated ${existing.trendStatus} → ${calc.trendStatus}`,
    oldValue: { trendStatus: existing.trendStatus },
    newValue: { trendStatus: calc.trendStatus },
    reason, now, esign: qaOverride,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: meta.trendId,
    actionType: 'Analysis Executed', description: `Recalc n=${calc.dataPointsCount}`,
    newValue: calc, reason, now,
  });
  emitAlerts(firestore, batch, actorUid, id, meta, calc, now);
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const reviewAdminTrendAnalysis = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for QA review');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'Trend analysis record not found');
  const existing = snap.data() || {};
  if (existing.status === 'Approved') throw new HttpsError('failed-precondition', 'Approved records cannot be reopened');
  const now = new Date().toISOString();
  const updates = {
    status: 'Under Review', reviewedBy: actorName, reviewDate: now.slice(0, 10),
    updatedAt: now, updatedBy: actorUid, updatedByName: actorName, changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.trendId || ''),
    actionType: 'Trend Review Submitted', description: 'Submitted for QA review',
    oldValue: existing.status, newValue: 'Under Review', reason, now,
  });
  notify(firestore, batch, {
    targetUid: actorUid, recordId: id, eventName: 'Workflow Pending',
    title: 'Trend Review Pending', message: `${existing.parameterName} awaiting approval`, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminTrendAnalysis = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature confirmation required to approve');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'Trend analysis record not found');
  const existing = snap.data() || {};
  if (!['Draft', 'Generated', 'Under Review'].includes(String(existing.status))) {
    throw new HttpsError('failed-precondition', `Cannot approve from status ${existing.status}`);
  }
  const now = new Date().toISOString();
  const updates = {
    status: 'Approved', isLocked: true, approvedBy: actorName, approvalDate: now.slice(0, 10),
    updatedAt: now, updatedBy: actorUid, updatedByName: actorName, changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.trendId || ''),
    actionType: 'Trend Approved', description: `Approved ${existing.trendId}`,
    oldValue: existing.status, newValue: 'Approved', reason, now, esign: true,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.trendId || ''),
    actionType: 'Electronic Signature', description: `E-sign by ${actorName}`, reason, now, esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const rejectAdminTrendAnalysis = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Rejected by QA');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'Trend analysis record not found');
  const existing = snap.data() || {};
  if (existing.status === 'Approved') throw new HttpsError('failed-precondition', 'Cannot reject approved records');
  const now = new Date().toISOString();
  const updates = {
    status: 'Rejected', updatedAt: now, updatedBy: actorUid, updatedByName: actorName, changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.trendId || ''),
    actionType: 'Trend Rejected', description: 'Rejected by QA',
    oldValue: existing.status, newValue: 'Rejected', reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const softDeleteAdminTrendAnalysis = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to archive');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'Trend analysis record not found');
  if (snap.data()?.status === 'Approved') {
    throw new HttpsError('failed-precondition', 'Cannot delete approved trend records');
  }
  const now = new Date().toISOString();
  const updates = {
    isDeleted: true, status: 'Archived', deletedAt: now, deletedBy: actorUid,
    updatedAt: now, updatedBy: actorUid, updatedByName: actorName, changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(snap.data()?.trendId || ''),
    actionType: 'Trend Archived', description: 'Soft-deleted trend analysis record',
    reason, now, esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminTrendAnalysisExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: 'export', actionType: 'Trend Export',
    description: `Exported ${Number(data.count || 0)} records`,
    newValue: { count: Number(data.count || 0), format: optionalString(data.format, 'Format', 40) || 'CSV' },
    reason: optionalString(data.changeReason, 'Change reason', 500) || 'Export', now,
  });
  await batch.commit();
  return { success: true };
});

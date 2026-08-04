/**
 * CPV Process Capability — privileged Cloud Functions.
 * Server-side Cp/Cpk/Pp/Ppk engine, dual audit, e-sign approve, CF-only writes.
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

function asFiniteNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new HttpsError('invalid-argument', `${field} must be a finite number`);
  }
  return n;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function round(n: number, d = 4): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** d) / 10 ** d;
}

const COLLECTION = 'process_capability';
const MODULE = 'Process Capability';

const ENTER_ROLES = ['super_admin', 'admin', 'qc', 'qc_manager'];
const REVIEW_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const VIEWER_ROLES = [
  ...ENTER_ROLES, ...REVIEW_ROLES,
  'production', 'production_manager', 'engineering', 'engineering_manager', 'viewer', 'auditor',
];

const PARAMETER_TYPES = ['CPP', 'CQA', 'Yield', 'Stability', 'Hold Time', 'Environmental', 'Utility'] as const;
const DATA_SOURCES = [
  'CPP Results', 'CQA Results', 'Yield Monitoring', 'Stability Monitoring',
  'Hold Time Monitoring', 'Environmental Monitoring', 'Utility Monitoring',
] as const;

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Process Capability view access required');
  }
}
function assertEnter(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ENTER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Process Capability entry access required');
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

function buildId(productCode: string, parameterCode: string): string {
  return `PCAP-${productCode}-${parameterCode}-${new Date().getFullYear()}`
    .replace(/\s+/g, '-').toUpperCase().slice(0, 80);
}
function buildCode(productCode: string, parameterCode: string): string {
  return `CAP-${productCode}-${parameterCode}`.replace(/\s+/g, '-').toUpperCase().slice(0, 60);
}

function evaluateStatus(cpk: number, sampleCount: number, canCalculate: boolean): string {
  if (sampleCount < 5) return 'Insufficient Data';
  if (!canCalculate) return 'Cannot Calculate';
  if (cpk >= 1.67) return 'Excellent';
  if (cpk >= 1.33) return 'Acceptable';
  if (cpk >= 1.0) return 'Needs Improvement';
  if (cpk >= 0.67) return 'Poor';
  return 'Not Capable';
}

function evaluateRisk(status: string, parameterType: string, parameterName: string, cpk: number): string {
  const critical = ['Sterility', 'Assay', 'Bacterial Endotoxin', 'Fill Volume', 'pH'];
  const isCritical = critical.some((p) => parameterName.toLowerCase().includes(p.toLowerCase()));
  if (status === 'Not Capable' || status === 'Poor' || cpk < 1.0) {
    if (isCritical && (parameterType === 'CQA' || parameterType === 'CPP')) return 'Critical';
    return 'High';
  }
  if (status === 'Needs Improvement' || cpk < 1.33) return 'Medium';
  return 'Low';
}

function healthScore(cpk: number, ppk: number, outlierCount: number, sampleCount: number): number {
  let score = Math.min(100, Math.max(0, (Math.min(cpk, ppk) / 1.67) * 100));
  if (outlierCount > 0) score -= Math.min(20, outlierCount * 5);
  if (sampleCount < 10) score -= 5;
  return round(Math.max(0, Math.min(100, score)), 1);
}

function aiRecommendation(cpk: number, ppk: number, cp: number, status: string, outlierCount: number, skewness: number, parameterName: string): string {
  const tips: string[] = [];
  if (cpk < 1.0) tips.push(`Cpk ${cpk} indicates process not capable for ${parameterName} — investigate special causes and consider CAPA.`);
  else if (cpk < 1.33) tips.push(`Cpk ${cpk} is below pharma target (≥1.33). Reduce variation or center the process.`);
  if (cp - cpk > 0.3) tips.push('Cp ≫ Cpk suggests process centering issue — adjust mean toward target.');
  if (ppk < cpk) tips.push('Ppk < Cpk indicates long-term variation exceeds short-term — review process stability over time.');
  if (outlierCount > 0) tips.push(`${outlierCount} outlier(s) detected — review Western Electric / Nelson rules.`);
  if (Math.abs(skewness) > 1) tips.push('Distribution skewness is elevated — verify normality.');
  if (!tips.length) tips.push(`Capability ${status} — continue routine monitoring.`);
  return tips.join(' ');
}

function calculateCapability(
  values: number[],
  lsl: number,
  usl: number,
  batchIds: string[],
  parameterType: string,
  parameterName: string,
  target?: number,
) {
  const clean = values.filter(Number.isFinite);
  const n = clean.length;
  const batchCount = new Set(batchIds.filter(Boolean)).size;
  if (n < 5) {
    throw new HttpsError('failed-precondition', 'At least 5 numeric values required for calculation');
  }
  if (lsl >= usl) throw new HttpsError('invalid-argument', 'USL must be greater than LSL');

  const sorted = [...clean].sort((a, b) => a - b);
  const mean = clean.reduce((s, v) => s + v, 0) / n;
  const mid = Math.floor(n / 2);
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const min = sorted[0];
  const max = sorted[n - 1];
  const overallVariance = n > 1 ? clean.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const overallSd = Math.sqrt(overallVariance);
  const movingRanges = clean.slice(1).map((v, i) => Math.abs(v - clean[i]));
  const mrBar = movingRanges.length ? movingRanges.reduce((s, v) => s + v, 0) / movingRanges.length : 0;
  const withinSd = mrBar > 0 ? mrBar / 1.128 : overallSd;

  const freq = new Map<number, number>();
  sorted.forEach((v) => freq.set(v, (freq.get(v) || 0) + 1));
  let mode: number | null = null;
  let maxF = 1;
  freq.forEach((f, v) => { if (f > maxF) { maxF = f; mode = v; } });

  let m3 = 0;
  let m4 = 0;
  const sdForMoments = overallSd || withinSd;
  if (sdForMoments > 0) {
    clean.forEach((v) => {
      const d = (v - mean) / sdForMoments;
      m3 += d ** 3;
      m4 += d ** 4;
    });
  }
  const skewness = round(m3 / n);
  const kurtosis = round(m4 / n - 3);
  const normalityPValue = n >= 8 ? round(Math.min(1, Math.max(0, Math.exp(-0.5 * (skewness ** 2 + kurtosis ** 2))))) : null;

  let outlierCount = 0;
  if (n >= 4) {
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    outlierCount = sorted.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length;
  }

  const se = overallSd / Math.sqrt(n);
  const confidenceIntervalLow = mean - 1.96 * se;
  const confidenceIntervalHigh = mean + 1.96 * se;

  let cp = 0;
  let cpu = 0;
  let cpl = 0;
  let cpk = 0;
  let pp = 0;
  let ppu = 0;
  let ppl = 0;
  let ppk = 0;

  if (overallSd === 0 && withinSd === 0) {
    const withinSpec = mean >= lsl && mean <= usl;
    cpk = withinSpec ? 2 : 0;
    cp = cpu = cpl = pp = ppu = ppl = ppk = cpk;
  } else {
    cp = withinSd > 0 ? (usl - lsl) / (6 * withinSd) : 0;
    cpu = withinSd > 0 ? (usl - mean) / (3 * withinSd) : 0;
    cpl = withinSd > 0 ? (mean - lsl) / (3 * withinSd) : 0;
    cpk = Math.min(cpu, cpl);
    pp = overallSd > 0 ? (usl - lsl) / (6 * overallSd) : 0;
    ppu = overallSd > 0 ? (usl - mean) / (3 * overallSd) : 0;
    ppl = overallSd > 0 ? (mean - lsl) / (3 * overallSd) : 0;
    ppk = Math.min(ppu, ppl);
  }

  const status = evaluateStatus(cpk, n, true);
  const risk = evaluateRisk(status, parameterType, parameterName, cpk);
  const score = healthScore(cpk, ppk, outlierCount, n);
  void target;

  return {
    batchCount: batchCount || n,
    sampleCount: n,
    mean: round(mean),
    median: round(median),
    mode: mode == null ? null : round(mode),
    minimumValue: round(min),
    maximumValue: round(max),
    range: round(max - min),
    variance: round(overallVariance),
    standardDeviation: round(overallSd),
    movingRangeBar: round(mrBar),
    withinStandardDeviation: round(withinSd),
    cp: round(cp),
    cpk: round(cpk),
    cpu: round(cpu),
    cpl: round(cpl),
    pp: round(pp),
    ppk: round(ppk),
    ppu: round(ppu),
    ppl: round(ppl),
    sigmaLevel: round(cpk * 3),
    zScoreLsl: overallSd > 0 ? round((mean - lsl) / overallSd) : 0,
    zScoreUsl: overallSd > 0 ? round((usl - mean) / overallSd) : 0,
    confidenceIntervalLow: round(confidenceIntervalLow),
    confidenceIntervalHigh: round(confidenceIntervalHigh),
    skewness,
    kurtosis,
    normalityPValue,
    outlierCount,
    processPerformanceIndex: round(Math.min(ppk, cpk)),
    capabilityStatus: status,
    riskLevel: risk,
    capaRecommended: cpk < 1.0,
    deviationRequired: cpk < 1.0 || status === 'Not Capable',
    healthScore: score,
    aiRecommendation: aiRecommendation(round(cpk), round(ppk), round(cp), status, outlierCount, skewness, parameterName),
    sourcePreview: clean.slice(0, 50),
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
    auditId: `AUD-PCAP-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now, timestamp: input.now, moduleName: 'CPV', subModule: MODULE,
    collectionName: COLLECTION, recordId: input.recordId, documentId: input.recordId,
    documentNumber: input.documentNumber || '', actionType: input.actionType, action: input.actionType,
    actionDescription: input.description, oldValue: input.oldValue ?? null, newValue: input.newValue ?? null,
    reason: input.reason || '', performedBy: input.actorName, userId: input.actorUid, userName: input.actorName,
    electronicSignature: input.esign === true, createdAt: input.now, source: 'cpv-process-capability-admin',
    immutable: true, appendOnly: true,
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: MODULE, action: input.actionType, recordId: input.recordId, description: input.description,
    performedBy: input.actorName, userId: input.actorUid, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: 'cpv-process-capability-admin',
  });
  batch.set(firestore.collection('cpv_audit_trail').doc(), {
    moduleName: MODULE, actionType: input.actionType, actionDescription: input.description,
    recordId: input.recordId, documentNumber: input.documentNumber || '',
    userId: input.actorUid, userName: input.actorName, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: 'cpv-process-capability-admin',
  });
}

function notify(
  firestore: Firestore, batch: WriteBatch,
  input: { targetUid: string; recordId: string; eventName: string; title: string; message: string; now: string },
) {
  batch.set(firestore.collection('notifications').doc(), {
    userId: input.targetUid, title: input.title, message: input.message, type: 'cpv_process_capability',
    eventName: input.eventName, recordId: input.recordId, module: MODULE,
    href: `/cpv/process-capability/${input.recordId}`, read: false, createdAt: input.now,
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
  const lsl = asFiniteNumber(data.lowerSpecificationLimit ?? existing?.lowerSpecificationLimit, 'LSL');
  const usl = asFiniteNumber(data.upperSpecificationLimit ?? existing?.upperSpecificationLimit, 'USL');
  if (lsl >= usl) throw new HttpsError('invalid-argument', 'USL must be greater than LSL');
  const productCode = requiredString(data.productCode ?? existing?.productCode, 'Product code', 80);
  const parameterCode = requiredString(data.parameterCode ?? existing?.parameterCode, 'Parameter code', 80);
  const from = requiredString(data.reviewPeriodFrom ?? existing?.reviewPeriodFrom, 'Review period from', 40);
  const to = requiredString(data.reviewPeriodTo ?? existing?.reviewPeriodTo, 'Review period to', 40);
  if (new Date(to) <= new Date(from)) {
    throw new HttpsError('invalid-argument', 'Review period end must be after start');
  }

  return {
    recordType: 'process_capability',
    capabilityCode: optionalString(data.capabilityCode ?? existing?.capabilityCode, 'Capability code', 80) || buildCode(productCode, parameterCode),
    studyNumber: optionalString(data.studyNumber ?? existing?.studyNumber, 'Study number', 80),
    cpvProductId: requiredString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),
    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    productCode,
    productVersion: optionalString(data.productVersion ?? existing?.productVersion, 'Product version', 40),
    batchNumber: optionalString(data.batchNumber ?? existing?.batchNumber, 'Batch number', 80),
    manufacturingOrder: optionalString(data.manufacturingOrder ?? existing?.manufacturingOrder, 'Manufacturing order', 80),
    process: optionalString(data.process ?? existing?.process, 'Process', 120),
    processStep: optionalString(data.processStep ?? existing?.processStep, 'Process step', 120),
    equipmentId: optionalString(data.equipmentId ?? existing?.equipmentId, 'Equipment id', 120),
    equipmentName: optionalString(data.equipmentName ?? existing?.equipmentName, 'Equipment name', 200),
    machine: optionalString(data.machine ?? existing?.machine, 'Machine', 120),
    department: optionalString(data.department ?? existing?.department, 'Department', 120) || 'Quality Control',
    productionLine: optionalString(data.productionLine ?? existing?.productionLine, 'Production line', 120),
    site: optionalString(data.site ?? existing?.site, 'Site', 120),
    parameterType,
    parameterCode,
    parameterName: requiredString(data.parameterName ?? existing?.parameterName, 'Parameter name', 200),
    dataSource,
    reviewPeriodFrom: from,
    reviewPeriodTo: to,
    lowerSpecificationLimit: lsl,
    upperSpecificationLimit: usl,
    targetValue: optionalFiniteNumber(data.targetValue ?? existing?.targetValue) ?? null,
    ucl: optionalFiniteNumber(data.ucl ?? existing?.ucl) ?? null,
    lcl: optionalFiniteNumber(data.lcl ?? existing?.lcl) ?? null,
    effectiveDate: optionalString(data.effectiveDate ?? existing?.effectiveDate, 'Effective date', 40),
    description: optionalString(data.description ?? existing?.description, 'Description', 2000),
    conclusion: optionalString(data.conclusion ?? existing?.conclusion, 'Conclusion', 2000),
    recommendation: optionalString(data.recommendation ?? existing?.recommendation, 'Recommendation', 2000),
    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),
    capabilityId: buildId(productCode, parameterCode),
  };
}

function parseValues(data: Record<string, unknown>, existing?: DocumentData): { values: number[]; batches: string[] } {
  const rawValues = Array.isArray(data.values) ? data.values : (Array.isArray(existing?.sourcePreview) ? existing!.sourcePreview : []);
  const values = rawValues.map(Number).filter(Number.isFinite);
  if (values.length < 5) {
    throw new HttpsError('failed-precondition', 'At least 5 numeric values required for calculation');
  }
  if (values.length > 5000) {
    throw new HttpsError('invalid-argument', 'Maximum 5000 values per analysis');
  }
  const rawBatches = Array.isArray(data.batchNumbers) ? data.batchNumbers.map(String) : [];
  const batches = rawBatches.length === values.length
    ? rawBatches
    : values.map((_, i) => rawBatches[i] || '');
  return { values, batches };
}

function emitAlerts(
  firestore: Firestore, batch: WriteBatch, actorUid: string, recordId: string,
  meta: ReturnType<typeof sanitizeMeta>, calc: ReturnType<typeof calculateCapability>, now: string,
) {
  if (calc.cpk < 1.0) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Low Cpk', title: 'Low Cpk Detected',
      message: `${meta.parameterName}: Cpk ${calc.cpk}`, now,
    });
  } else if (calc.cpk < 1.33) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Low Cpk', title: 'Cpk Below Target',
      message: `${meta.parameterName}: Cpk ${calc.cpk} < 1.33`, now,
    });
  }
  if (calc.cp < 1.33) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Low Cp', title: 'Low Cp Detected',
      message: `${meta.parameterName}: Cp ${calc.cp}`, now,
    });
  }
  if (calc.ppk < 1.0) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Low Ppk', title: 'Low Ppk Detected',
      message: `${meta.parameterName}: Ppk ${calc.ppk}`, now,
    });
  }
  if (calc.sigmaLevel > 0 && calc.sigmaLevel < 3) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Sigma Drop', title: 'Sigma Level Drop',
      message: `${meta.parameterName}: sigma ${calc.sigmaLevel}`, now,
    });
  }
  if (calc.deviationRequired) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Deviation Created', title: 'Capability Deviation Required',
      message: `${meta.parameterName}: ${calc.capabilityStatus}`, now,
    });
  }
  if (calc.capaRecommended) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'CAPA Created', title: 'CAPA Recommended',
      message: `${meta.parameterName}: Cpk ${calc.cpk}`, now,
    });
  }
}

export const createAdminProcessCapability = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);
  await assertOperationalProduct(firestore, requiredString(data.cpvProductId, 'CPV product', 120));
  const meta = sanitizeMeta(data);
  const { values, batches } = parseValues(data);
  const calc = withAiRecommendationOverride(
    calculateCapability(
      values, meta.lowerSpecificationLimit, meta.upperSpecificationLimit, batches,
      meta.parameterType, meta.parameterName, meta.targetValue ?? undefined,
    ),
    data,
  );

  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const record = {
    ...meta,
    ...calc,
    id: ref.id,
    linkedRiskId: '',
    linkedDeviationNumber: '',
    linkedCapaNumber: '',
    status: 'Calculated' as const,
    isLocked: false,
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
    actorUid, actorName, recordId: ref.id, documentNumber: meta.capabilityId,
    actionType: 'Capability Created', description: `Created ${meta.capabilityId} Cpk ${calc.cpk}`,
    newValue: { cpk: calc.cpk, ppk: calc.ppk, status: calc.capabilityStatus }, reason, now,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: meta.capabilityId,
    actionType: 'Analysis Executed', description: `n=${calc.sampleCount} Cp=${calc.cp} Cpk=${calc.cpk} Pp=${calc.pp} Ppk=${calc.ppk}`,
    newValue: calc, reason, now,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: meta.capabilityId,
    actionType: 'AI Analysis Generated', description: calc.aiRecommendation.slice(0, 500),
    newValue: { healthScore: calc.healthScore }, reason, now,
  });
  emitAlerts(firestore, batch, actorUid, ref.id, meta, calc, now);
  await batch.commit();
  return record;
});

export const recalculateAdminProcessCapability = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Capability record not found');
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
  const { values, batches } = parseValues(data, existing);
  const calc = withAiRecommendationOverride(
    calculateCapability(
      values, meta.lowerSpecificationLimit, meta.upperSpecificationLimit, batches,
      meta.parameterType, meta.parameterName, meta.targetValue ?? undefined,
    ),
    data,
  );
  const now = new Date().toISOString();
  const updates = {
    ...meta,
    ...calc,
    status: 'Calculated',
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: meta.capabilityId,
    actionType: qaOverride ? 'Capability QA Override' : 'Capability Updated',
    description: `Recalculated Cpk ${existing.cpk} → ${calc.cpk}`,
    oldValue: { cpk: existing.cpk, ppk: existing.ppk },
    newValue: { cpk: calc.cpk, ppk: calc.ppk },
    reason, now, esign: qaOverride,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: meta.capabilityId,
    actionType: 'Analysis Executed', description: `Recalc n=${calc.sampleCount}`,
    newValue: calc, reason, now,
  });
  emitAlerts(firestore, batch, actorUid, id, meta, calc, now);
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const reviewAdminProcessCapability = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for QA review');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'Capability record not found');
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
    actorUid, actorName, recordId: id, documentNumber: String(existing.capabilityId || ''),
    actionType: 'Capability Review Submitted', description: 'Submitted for QA review',
    oldValue: existing.status, newValue: 'Under Review', reason, now,
  });
  notify(firestore, batch, {
    targetUid: actorUid, recordId: id, eventName: 'Workflow Pending',
    title: 'Capability Review Pending', message: `${existing.parameterName} awaiting approval`, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminProcessCapability = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature confirmation required to approve');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'Capability record not found');
  const existing = snap.data() || {};
  if (!['Draft', 'Calculated', 'Under Review'].includes(String(existing.status))) {
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
    actorUid, actorName, recordId: id, documentNumber: String(existing.capabilityId || ''),
    actionType: 'Capability Approved', description: `Approved ${existing.capabilityId}`,
    oldValue: existing.status, newValue: 'Approved', reason, now, esign: true,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.capabilityId || ''),
    actionType: 'Electronic Signature', description: `E-sign by ${actorName}`, reason, now, esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const rejectAdminProcessCapability = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Rejected by QA');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'Capability record not found');
  const existing = snap.data() || {};
  if (existing.status === 'Approved') throw new HttpsError('failed-precondition', 'Cannot reject approved records');
  const now = new Date().toISOString();
  const updates = {
    status: 'Rejected', updatedAt: now, updatedBy: actorUid, updatedByName: actorName, changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.capabilityId || ''),
    actionType: 'Capability Rejected', description: 'Rejected by QA',
    oldValue: existing.status, newValue: 'Rejected', reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const softDeleteAdminProcessCapability = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to archive');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'Capability record not found');
  if (snap.data()?.status === 'Approved') {
    throw new HttpsError('failed-precondition', 'Cannot delete approved capability records');
  }
  const now = new Date().toISOString();
  const updates = {
    isDeleted: true, status: 'Archived', deletedAt: now, deletedBy: actorUid,
    updatedAt: now, updatedBy: actorUid, updatedByName: actorName, changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(snap.data()?.capabilityId || ''),
    actionType: 'Capability Archived', description: 'Soft-deleted capability record',
    reason, now, esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminProcessCapabilityExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: 'export', actionType: 'Capability Export',
    description: `Exported ${Number(data.count || 0)} records`,
    newValue: { count: Number(data.count || 0), format: optionalString(data.format, 'Format', 40) || 'CSV' },
    reason: optionalString(data.changeReason, 'Change reason', 500) || 'Export', now,
  });
  await batch.commit();
  return { success: true };
});

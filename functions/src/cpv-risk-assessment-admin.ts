/**
 * CPV Risk Assessment Worksheet — privileged Cloud Functions.
 * Server-side RPN engine, dual audit, e-sign approve/close, CF-only writes.
 * Hardens the existing Risk Assessment module (collection: risk_assessment).
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';
import { assertOperationalCpvProduct } from './cpv-batch-guard';
import { withAiRecommendationOverride } from './ai-recommendation-override';


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

function requiredScore(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 10) {
    throw new HttpsError('invalid-argument', `${field} must be between 1 and 10`);
  }
  return Math.floor(n);
}

function optionalResidualScore(value: unknown, field: string): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10) {
    throw new HttpsError('invalid-argument', `${field} must be between 0 and 10`);
  }
  return Math.floor(n);
}

function round(n: number, d = 3): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** d) / 10 ** d;
}

const COLLECTION = 'risk_assessment';
const CONTROLS_COLLECTION = 'risk_controls';
const REVIEWS_COLLECTION = 'risk_reviews';
const MODULE = 'CPV Risk Assessment Worksheet';

const ENTER_ROLES = [
  'super_admin', 'admin', 'qc', 'qc_manager',
  'production', 'production_manager', 'engineering', 'engineering_manager',
];
const REVIEW_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const CLOSE_ROLES = REVIEW_ROLES;
const VIEWER_ROLES = [
  ...ENTER_ROLES, ...REVIEW_ROLES, 'viewer', 'auditor',
];

const METHODOLOGIES = [
  'FMEA', 'FMECA', 'HACCP', 'HAZOP', 'Fault Tree Analysis', 'Fishbone Diagram',
  'Bow-Tie Analysis', '5 Why Analysis', 'Risk Matrix 5x5', 'Risk Matrix 3x3',
] as const;

const RISK_CATEGORIES = [
  'CPP Risk', 'CQA Risk', 'Yield Risk', 'Stability Risk', 'Raw Material Risk',
  'Packing Material Risk', 'Utility Risk', 'Environmental Risk', 'Hold Time Risk',
  'Process Capability Risk', 'Vendor Risk', 'Equipment Risk', 'Process Risk',
  'Quality Risk', 'Personnel Risk', 'Microbiological Risk', 'Data Integrity Risk',
  'Computer System Risk', 'Cybersecurity Risk', 'Regulatory Risk', 'Validation Risk',
  'Business Continuity Risk', 'Supplier Risk', 'Material Risk',
] as const;

const RISK_SOURCES = [
  'Manual Assessment', 'CPP Monitoring', 'CQA Monitoring', 'Yield Monitoring',
  'Stability Monitoring', 'Raw Material Monitoring', 'Packing Material Monitoring',
  'Utility Monitoring', 'Environmental Monitoring', 'Hold Time Monitoring',
  'Trend Analysis', 'SPC', 'Process Capability', 'Deviation', 'OOS', 'CAPA',
] as const;

const PARAMETER_TYPES = [
  'CPP', 'CQA', 'Yield', 'Stability', 'Raw Material', 'Packing Material',
  'Utility', 'Environmental', 'Hold Time', 'Process Capability',
] as const;

const EFFECTIVENESS_STATUSES = ['Pending', 'Effective', 'Partially Effective', 'Not Effective'] as const;

type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

interface RiskControlRecord {
  controlId: string;
  controlDescription: string;
  controlType: string;
  owner: string;
  targetDate: string;
  status: string;
  effectiveness: string;
}

interface RiskReviewRecord {
  reviewDate: string;
  reviewer: string;
  comments: string;
  decision: string;
  status: string;
}

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Risk Assessment view access required');
  }
}

function assertEnter(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ENTER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Risk Assessment entry access required');
  }
}

function assertReviewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !REVIEW_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'QA review/approve access required');
  }
}

function assertCloser(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !CLOSE_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'QA close access required');
  }
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
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

function buildRiskAssessmentId(productCode: string): string {
  const year = new Date().getFullYear();
  return `RA-${productCode || 'PRD'}-${year}`.replace(/\s+/g, '-').toUpperCase().slice(0, 80);
}

async function buildRiskNumber(firestore: Firestore): Promise<string> {
  const year = new Date().getFullYear();
  try {
    const prefix = `RISK/${year}/`;
    const snap = await firestore.collection(COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    let maxSeq = 0;
    snap.docs.forEach((doc) => {
      const rn = String(doc.data()?.riskNumber || '');
      if (rn.startsWith(prefix)) {
        const seq = parseInt(rn.slice(prefix.length), 10);
        if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
      }
    });
    return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
  } catch {
    const fallback = Math.floor(Date.now() % 9000) + 1000;
    return `RISK/${year}/${String(fallback).padStart(4, '0')}`;
  }
}

function calculateRiskAssessment(
  severity: number,
  occurrence: number,
  detection: number,
  residual?: { severity?: number; occurrence?: number; detection?: number },
) {
  const s = Math.min(10, Math.max(1, Math.round(severity)));
  const o = Math.min(10, Math.max(1, Math.round(occurrence)));
  const d = Math.min(10, Math.max(1, Math.round(detection)));
  const rpnScore = s * o * d;

  let riskLevel: RiskLevel = 'Low';
  if (rpnScore >= 201 || s >= 9) riskLevel = 'Critical';
  else if (rpnScore >= 101 || s >= 7) riskLevel = 'High';
  else if (rpnScore >= 51) riskLevel = 'Medium';

  const rs = residual?.severity && residual.severity > 0
    ? Math.min(10, Math.max(1, Math.round(residual.severity))) : 0;
  const ro = residual?.occurrence && residual.occurrence > 0
    ? Math.min(10, Math.max(1, Math.round(residual.occurrence))) : 0;
  const rd = residual?.detection && residual.detection > 0
    ? Math.min(10, Math.max(1, Math.round(residual.detection))) : 0;
  const residualRpn = rs > 0 && ro > 0 && rd > 0 ? rs * ro * rd : 0;

  let residualRiskLevel = '';
  if (residualRpn > 0) {
    if (residualRpn >= 201 || rs >= 9) residualRiskLevel = 'Critical';
    else if (residualRpn >= 101 || rs >= 7) residualRiskLevel = 'High';
    else if (residualRpn >= 51) residualRiskLevel = 'Medium';
    else residualRiskLevel = 'Low';
  }

  const riskReductionPercent = residualRpn > 0 && rpnScore > 0
    ? Math.max(0, Math.min(100, Math.round(((rpnScore - residualRpn) / rpnScore) * 100)))
    : 0;

  const criticality = Math.round((s * o) / 10);
  const probability = o;
  const impact = s;
  const likelihood = Math.round((o + (11 - d)) / 2);

  let healthScore = 100;
  if (riskLevel === 'Critical') healthScore -= 45;
  else if (riskLevel === 'High') healthScore -= 30;
  else if (riskLevel === 'Medium') healthScore -= 15;
  if (residualRpn > 0 && residualRpn >= rpnScore) healthScore -= 10;
  healthScore = Math.max(0, Math.min(100, healthScore));

  const confidenceScore = Math.max(40, Math.min(99, 55 + (residualRpn > 0 ? 15 : 0) + (s >= 7 ? 5 : 10)));

  const tips: string[] = [];
  if (riskLevel === 'Critical') tips.push('Critical RPN — escalate to QA and consider deviation/CAPA.');
  else if (riskLevel === 'High') tips.push('High risk — implement mitigation controls and schedule effectiveness check.');
  if (d >= 8) tips.push('High detection score indicates weak detectability — strengthen monitoring controls.');
  if (residualRpn > 0 && residualRpn >= 101) tips.push(`Residual RPN ${residualRpn} remains elevated after mitigation.`);
  if (riskReductionPercent >= 50) tips.push(`Risk reduced by ${riskReductionPercent}% — verify effectiveness.`);
  if (!tips.length) tips.push(`RPN ${rpnScore} (${riskLevel}) — continue routine ICH Q9 risk monitoring.`);

  const capaSuggested = riskLevel === 'Critical' || riskLevel === 'High';
  const deviationRequired = riskLevel === 'Critical' || (s >= 9 && o >= 5);

  return {
    rpnScore,
    riskLevel,
    residualRpn,
    residualRiskLevel,
    riskReductionPercent,
    criticality,
    probability,
    impact,
    likelihood,
    healthScore: round(healthScore, 1),
    confidenceScore,
    aiRecommendation: tips.join(' '),
    capaSuggested,
    deviationRequired,
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
    auditId: `AUD-RISK-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now, timestamp: input.now, moduleName: 'CPV', subModule: MODULE,
    collectionName: COLLECTION, recordId: input.recordId, documentId: input.recordId,
    documentNumber: input.documentNumber || '', actionType: input.actionType, action: input.actionType,
    actionDescription: input.description, oldValue: input.oldValue ?? null, newValue: input.newValue ?? null,
    reason: input.reason || '', performedBy: input.actorName, userId: input.actorUid, userName: input.actorName,
    electronicSignature: input.esign === true, createdAt: input.now, source: 'cpv-risk-assessment-admin',
    immutable: true, appendOnly: true,
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: MODULE, action: input.actionType, recordId: input.recordId, description: input.description,
    performedBy: input.actorName, userId: input.actorUid, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: 'cpv-risk-assessment-admin',
  });
  batch.set(firestore.collection('cpv_audit_trail').doc(), {
    moduleName: MODULE, actionType: input.actionType, actionDescription: input.description,
    recordId: input.recordId, documentNumber: input.documentNumber || '',
    userId: input.actorUid, userName: input.actorName, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: 'cpv-risk-assessment-admin',
  });
}

function notify(
  firestore: Firestore, batch: WriteBatch,
  input: { targetUid: string; recordId: string; eventName: string; title: string; message: string; now: string },
) {
  batch.set(firestore.collection('notifications').doc(), {
    userId: input.targetUid, title: input.title, message: input.message, type: 'cpv_risk_assessment',
    eventName: input.eventName, recordId: input.recordId, module: MODULE,
    href: `/cpv/risk-assessment/${input.recordId}`, read: false, createdAt: input.now,
  });
}

async function assertOperationalProduct(firestore: Firestore, productId: string) {
  if (!productId) return;
  const snap = await firestore.collection('cpv_products').doc(productId).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('failed-precondition', 'CPV product not found');
  }
  const status = String(snap.data()?.cpvStatus || '');
  if (!['Active', 'Under Review', 'Approved'].includes(status)) {
    throw new HttpsError('failed-precondition', 'Selected CPV product is not operational');
  }
}

function isLockedRecord(existing: DocumentData): boolean {
  const status = String(existing.riskStatus || existing.status || '');
  return existing.isLocked === true || status === 'Approved' || status === 'Closed';
}

function sanitizeMeta(data: Record<string, unknown>, existing?: DocumentData) {
  const methodology = requiredString(data.methodology ?? existing?.methodology, 'Methodology', 80);
  if (!METHODOLOGIES.includes(methodology as typeof METHODOLOGIES[number])) {
    throw new HttpsError('invalid-argument', `Invalid methodology: ${methodology}`);
  }

  const riskCategory = requiredString(data.riskCategory ?? existing?.riskCategory, 'Risk category', 80);
  if (!RISK_CATEGORIES.includes(riskCategory as typeof RISK_CATEGORIES[number])) {
    throw new HttpsError('invalid-argument', `Invalid risk category: ${riskCategory}`);
  }

  const riskSource = requiredString(data.riskSource ?? existing?.riskSource, 'Risk source', 80);
  if (!RISK_SOURCES.includes(riskSource as typeof RISK_SOURCES[number])) {
    throw new HttpsError('invalid-argument', `Invalid risk source: ${riskSource}`);
  }

  const parameterTypeRaw = optionalString(data.parameterType ?? existing?.parameterType, 'Parameter type', 40) || 'CPP';
  if (!PARAMETER_TYPES.includes(parameterTypeRaw as typeof PARAMETER_TYPES[number])) {
    throw new HttpsError('invalid-argument', `Invalid parameter type: ${parameterTypeRaw}`);
  }

  const productCode = optionalString(data.productCode ?? existing?.productCode, 'Product code', 80) || 'PRD';
  const severityScore = requiredScore(data.severityScore ?? existing?.severityScore, 'Severity score');
  const occurrenceScore = requiredScore(data.occurrenceScore ?? existing?.occurrenceScore, 'Occurrence score');
  const detectionScore = requiredScore(data.detectionScore ?? existing?.detectionScore, 'Detection score');
  const residualSeverity = optionalResidualScore(data.residualSeverity ?? existing?.residualSeverity, 'Residual severity');
  const residualOccurrence = optionalResidualScore(data.residualOccurrence ?? existing?.residualOccurrence, 'Residual occurrence');
  const residualDetection = optionalResidualScore(data.residualDetection ?? existing?.residualDetection, 'Residual detection');

  const calc = calculateRiskAssessment(severityScore, occurrenceScore, detectionScore, {
    severity: residualSeverity,
    occurrence: residualOccurrence,
    detection: residualDetection,
  });

  const cpvProductId = optionalString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120);
  const effectivenessCheckRequired = data.effectivenessCheckRequired ?? existing?.effectivenessCheckRequired;
  const effRequired = effectivenessCheckRequired === undefined ? true : effectivenessCheckRequired === true;

  return {
    recordType: 'risk_assessment',
    riskAssessmentId: optionalString(data.riskAssessmentId ?? existing?.riskAssessmentId, 'Risk assessment id', 80)
      || buildRiskAssessmentId(productCode),
    cpvProductId,
    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    productCode,
    productVersion: optionalString(data.productVersion ?? existing?.productVersion, 'Product version', 40),
    batchNumber: optionalString(data.batchNumber ?? existing?.batchNumber, 'Batch number', 80),
    title: optionalString(data.title ?? existing?.title, 'Title', 200),
    methodology: methodology as typeof METHODOLOGIES[number],
    riskCategory: riskCategory as typeof RISK_CATEGORIES[number],
    riskSource: riskSource as typeof RISK_SOURCES[number],
    process: optionalString(data.process ?? existing?.process, 'Process', 120),
    processStep: optionalString(data.processStep ?? existing?.processStep, 'Process step', 120),
    processStage: optionalString(data.processStage ?? existing?.processStage, 'Process stage', 120),
    department: optionalString(data.department ?? existing?.department, 'Department', 120) || 'Quality Control',
    site: optionalString(data.site ?? existing?.site, 'Site', 120),
    equipmentId: optionalString(data.equipmentId ?? existing?.equipmentId, 'Equipment id', 120),
    equipmentName: optionalString(data.equipmentName ?? existing?.equipmentName, 'Equipment name', 200),
    machine: optionalString(data.machine ?? existing?.machine, 'Machine', 120),
    material: optionalString(data.material ?? existing?.material, 'Material', 120),
    supplier: optionalString(data.supplier ?? existing?.supplier, 'Supplier', 120),
    utility: optionalString(data.utility ?? existing?.utility, 'Utility', 120),
    environmentalCondition: optionalString(data.environmentalCondition ?? existing?.environmentalCondition, 'Environmental condition', 200),
    parameterType: parameterTypeRaw as typeof PARAMETER_TYPES[number],
    parameterName: optionalString(data.parameterName ?? existing?.parameterName, 'Parameter name', 200),
    riskDescription: requiredString(data.riskDescription ?? existing?.riskDescription, 'Risk description', 2000),
    potentialImpact: optionalString(data.potentialImpact ?? existing?.potentialImpact, 'Potential impact', 2000),
    potentialCause: optionalString(data.potentialCause ?? existing?.potentialCause, 'Potential cause', 2000),
    existingControls: optionalString(data.existingControls ?? existing?.existingControls, 'Existing controls', 2000),
    severityScore,
    occurrenceScore,
    detectionScore,
    residualSeverity,
    residualOccurrence,
    residualDetection,
    riskOwner: requiredString(data.riskOwner ?? existing?.riskOwner, 'Risk owner', 120),
    mitigationAction: optionalString(data.mitigationAction ?? existing?.mitigationAction, 'Mitigation action', 2000),
    targetCompletionDate: requiredString(data.targetCompletionDate ?? existing?.targetCompletionDate, 'Target completion date', 40),
    assessmentDate: optionalString(data.assessmentDate ?? existing?.assessmentDate, 'Assessment date', 40)
      || new Date().toISOString().slice(0, 10),
    reviewFrequency: optionalString(data.reviewFrequency ?? existing?.reviewFrequency, 'Review frequency', 80),
    priority: optionalString(data.priority ?? existing?.priority, 'Priority', 40),
    version: optionalString(data.version ?? existing?.version, 'Version', 20) || '1.0',
    effectivenessCheckRequired: effRequired,
    linkedCapaNumber: optionalString(data.linkedCapaNumber ?? existing?.linkedCapaNumber, 'Linked CAPA number', 80),
    linkedDeviationNumber: optionalString(data.linkedDeviationNumber ?? existing?.linkedDeviationNumber, 'Linked deviation number', 80),
    linkedOosNumber: optionalString(data.linkedOosNumber ?? existing?.linkedOosNumber, 'Linked OOS number', 80),
    linkedChangeControlNumber: optionalString(data.linkedChangeControlNumber ?? existing?.linkedChangeControlNumber, 'Linked change control number', 80),
    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),
    ...withAiRecommendationOverride(calc, data),
  };
}

function isOverdue(targetCompletionDate: string, riskStatus: string): boolean {
  if (!targetCompletionDate) return false;
  if (['Closed', 'Accepted', 'Rejected'].includes(riskStatus)) return false;
  return new Date(`${targetCompletionDate}T23:59:59`) < new Date();
}

function emitAlerts(
  firestore: Firestore,
  batch: WriteBatch,
  actorUid: string,
  recordId: string,
  meta: ReturnType<typeof sanitizeMeta>,
  riskStatus: string,
  now: string,
) {
  if (meta.riskLevel === 'Critical') {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Critical Risk Created',
      title: 'Critical Risk Created', message: `${meta.productName}: RPN ${meta.rpnScore}`, now,
    });
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Management Escalation',
      title: 'Management Escalation', message: `Critical risk ${meta.riskAssessmentId} requires escalation`, now,
    });
  } else if (meta.riskLevel === 'High') {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'High Risk Created',
      title: 'High Risk Created', message: `${meta.productName}: RPN ${meta.rpnScore}`, now,
    });
  }

  if (meta.reviewFrequency) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Risk Review Due',
      title: 'Risk Review Due', message: `${meta.riskAssessmentId} review frequency: ${meta.reviewFrequency}`, now,
    });
  }

  if (isOverdue(meta.targetCompletionDate, riskStatus)) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Mitigation Overdue',
      title: 'Mitigation Overdue', message: `${meta.riskAssessmentId} past target ${meta.targetCompletionDate}`, now,
    });
  }

  if (meta.capaSuggested || meta.linkedCapaNumber) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'CAPA Created',
      title: 'CAPA Created', message: meta.linkedCapaNumber
        ? `CAPA ${meta.linkedCapaNumber} linked`
        : `CAPA suggested for ${meta.riskAssessmentId}`, now,
    });
  }

  if (meta.deviationRequired || meta.linkedDeviationNumber) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Deviation Created',
      title: 'Deviation Created', message: meta.linkedDeviationNumber
        ? `Deviation ${meta.linkedDeviationNumber} linked`
        : `Deviation required for ${meta.riskAssessmentId}`, now,
    });
  }

  if (riskStatus === 'Under Review') {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Workflow Pending',
      title: 'Workflow Pending', message: `${meta.riskAssessmentId} awaiting workflow action`, now,
    });
  }

  if (riskStatus === 'Pending Approval') {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, eventName: 'Approval Pending',
      title: 'Approval Pending', message: `${meta.riskAssessmentId} awaiting QA approval`, now,
    });
  }
}

function writeRiskReview(
  batch: WriteBatch,
  firestore: Firestore,
  riskAssessmentId: string,
  riskNumber: string,
  review: RiskReviewRecord,
  actorUid: string,
  now: string,
) {
  batch.set(firestore.collection(REVIEWS_COLLECTION).doc(), {
    ...review,
    riskAssessmentId,
    riskNumber,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
    isDeleted: false,
  });
}

function writeRiskControl(
  batch: WriteBatch,
  firestore: Firestore,
  riskAssessmentId: string,
  riskNumber: string,
  control: RiskControlRecord,
  actorUid: string,
  now: string,
) {
  batch.set(firestore.collection(CONTROLS_COLLECTION).doc(), {
    ...control,
    riskAssessmentId,
    riskNumber,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
    isDeleted: false,
  });
}

async function loadRecord(firestore: Firestore, id: string) {
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Risk assessment record not found');
  }
  return { snap, existing: snap.data() || {} };
}

export const createAdminRiskAssessment = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);

  const cpvProductId = requiredString(data.cpvProductId, 'CPV product', 120);
  const product = await assertOperationalCpvProduct(firestore, cpvProductId);

  const meta = sanitizeMeta(data);
  meta.cpvProductId = cpvProductId;
  meta.productName = String(product.productName || meta.productName);
  meta.productCode = String(product.productCode || meta.productCode);
  const riskNumber = await buildRiskNumber(firestore);
  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();

  const record = {
    ...meta,
    id: ref.id,
    riskNumber,
    riskStatus: 'Open' as const,
    workflowStatus: 'Draft' as const,
    effectivenessStatus: 'Pending' as const,
    repeatedRiskDetected: false,
    missingControls: !meta.existingControls && !meta.mitigationAction,
    mitigationOverdue: isOverdue(meta.targetCompletionDate, 'Open'),
    isAutoGenerated: data.isAutoGenerated === true,
    isLocked: false,
    reviewedBy: '',
    reviewDate: '',
    approvedBy: '',
    approvalDate: '',
    closedBy: '',
    closedDate: '',
    controls: [] as RiskControlRecord[],
    reviews: [] as RiskReviewRecord[],
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
    actorUid, actorName, recordId: ref.id, documentNumber: riskNumber,
    actionType: 'Risk Created', description: `Created ${riskNumber} RPN=${meta.rpnScore} (${meta.riskLevel})`,
    newValue: { riskLevel: meta.riskLevel, rpnScore: meta.rpnScore }, reason, now,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: riskNumber,
    actionType: 'Analysis Executed', description: `S=${meta.severityScore} O=${meta.occurrenceScore} D=${meta.detectionScore} RPN=${meta.rpnScore}`,
    newValue: { severityScore: meta.severityScore, occurrenceScore: meta.occurrenceScore, detectionScore: meta.detectionScore, rpnScore: meta.rpnScore },
    reason, now,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: riskNumber,
    actionType: 'AI Prediction Generated', description: meta.aiRecommendation.slice(0, 500),
    newValue: { healthScore: meta.healthScore, confidenceScore: meta.confidenceScore, capaSuggested: meta.capaSuggested },
    reason, now,
  });
  emitAlerts(firestore, batch, actorUid, ref.id, meta, 'Open', now);
  await batch.commit();
  return record;
});

export const updateAdminRiskAssessment = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;

  const { snap, existing } = await loadRecord(firestore, id);

  if (isLockedRecord(existing)) {
    if (!qaOverride) throw new HttpsError('failed-precondition', 'Approved/Closed record is locked. QA override required.');
    assertReviewer(actor, actorRole);
    if (data.esignConfirmed !== true) {
      throw new HttpsError('failed-precondition', 'Electronic signature required for QA override');
    }
  } else {
    assertEnter(actor, actorRole);
  }

  const cpvProductId = optionalString(data.cpvProductId ?? existing.cpvProductId, 'CPV product', 120);
  if (cpvProductId) await assertOperationalProduct(firestore, cpvProductId);

  const meta = sanitizeMeta({ ...existing, ...data }, existing);
  const now = new Date().toISOString();
  const riskStatus = String(existing.riskStatus || 'Open');

  const updates = {
    ...meta,
    missingControls: !meta.existingControls && !(existing.controls as RiskControlRecord[] | undefined)?.length,
    mitigationOverdue: isOverdue(meta.targetCompletionDate, riskStatus),
    isLocked: qaOverride ? false : existing.isLocked === true,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: qaOverride ? 'Risk Updated' : 'Risk Updated',
    description: qaOverride
      ? `QA override update RPN ${existing.rpnScore ?? '?'} → ${meta.rpnScore}`
      : `Updated risk RPN ${meta.rpnScore} (${meta.riskLevel})`,
    oldValue: { rpnScore: existing.rpnScore, riskLevel: existing.riskLevel },
    newValue: { rpnScore: meta.rpnScore, riskLevel: meta.riskLevel },
    reason, now, esign: qaOverride,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: 'Analysis Executed', description: `Recalc RPN=${meta.rpnScore}`,
    newValue: meta, reason, now,
  });
  if (qaOverride) {
    writeAudit(batch, firestore, {
      actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
      actionType: 'Electronic Signature', description: `QA override e-sign by ${actorName}`,
      reason, now, esign: true,
    });
  }
  emitAlerts(firestore, batch, actorUid, id, meta, riskStatus, now);
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const reviewAdminRiskAssessment = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for QA review');
  const comments = optionalString(data.comments, 'Comments', 2000);

  const { snap, existing } = await loadRecord(firestore, id);
  if (String(existing.riskStatus) === 'Approved') {
    throw new HttpsError('failed-precondition', 'Approved records cannot be reopened for review');
  }
  if (String(existing.riskStatus) === 'Closed') {
    throw new HttpsError('failed-precondition', 'Closed records cannot be reviewed');
  }

  const now = new Date().toISOString();
  const reviewDate = now.slice(0, 10);
  const review: RiskReviewRecord = {
    reviewDate,
    reviewer: actorName,
    comments,
    decision: 'Under Review',
    status: 'Under Review',
  };
  const priorReviews = Array.isArray(existing.reviews) ? existing.reviews as RiskReviewRecord[] : [];

  const updates = {
    riskStatus: 'Under Review',
    workflowStatus: 'Review',
    reviewedBy: actorName,
    reviewDate,
    reviews: [...priorReviews, review],
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeRiskReview(batch, firestore, id, String(existing.riskNumber || ''), review, actorUid, now);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: 'Risk Reviewed', description: 'Submitted for QA review',
    oldValue: existing.riskStatus, newValue: 'Under Review', reason, now,
  });
  notify(firestore, batch, {
    targetUid: actorUid, recordId: id, eventName: 'Approval Pending',
    title: 'Approval Pending', message: `${existing.riskAssessmentId || id} awaiting approval`, now,
  });
  notify(firestore, batch, {
    targetUid: actorUid, recordId: id, eventName: 'Workflow Pending',
    title: 'Workflow Pending', message: `${existing.riskAssessmentId || id} in review workflow`, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminRiskAssessment = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature confirmation required to approve');
  }

  const { snap, existing } = await loadRecord(firestore, id);
  const currentStatus = String(existing.riskStatus || '');
  if (!['Draft', 'Open', 'Under Review', 'Pending Approval'].includes(currentStatus)) {
    throw new HttpsError('failed-precondition', `Cannot approve from status ${currentStatus}`);
  }

  const now = new Date().toISOString();
  const hasMitigation = Boolean(existing.mitigationAction) || (Array.isArray(existing.controls) && existing.controls.length > 0);
  const updates = {
    riskStatus: hasMitigation ? 'Mitigation In Progress' : 'Approved',
    workflowStatus: 'Mitigation',
    approvedBy: actorName,
    approvalDate: now.slice(0, 10),
    isLocked: true,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: 'Risk Approved', description: `Approved ${existing.riskNumber || id}`,
    oldValue: existing.riskStatus, newValue: updates.riskStatus, reason, now, esign: true,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: 'Electronic Signature', description: `Approval e-sign by ${actorName}`,
    reason, now, esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const rejectAdminRiskAssessment = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Rejected by QA');

  const { snap, existing } = await loadRecord(firestore, id);
  if (String(existing.riskStatus) === 'Approved') {
    throw new HttpsError('failed-precondition', 'Cannot reject approved records');
  }
  if (String(existing.riskStatus) === 'Closed') {
    throw new HttpsError('failed-precondition', 'Cannot reject closed records');
  }

  const now = new Date().toISOString();
  const updates = {
    riskStatus: 'Rejected',
    workflowStatus: 'Closure',
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: 'Risk Rejected', description: 'Rejected by QA',
    oldValue: existing.riskStatus, newValue: 'Rejected', reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const addControlAdminRiskAssessment = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Mitigation control added');

  const { snap, existing } = await loadRecord(firestore, id);
  if (String(existing.riskStatus) === 'Closed') {
    throw new HttpsError('failed-precondition', 'Cannot add controls to closed records');
  }

  const control: RiskControlRecord = {
    controlId: `CTRL-${Date.now()}`.slice(0, 20),
    controlDescription: requiredString(data.controlDescription, 'Control description', 2000),
    controlType: optionalString(data.controlType, 'Control type', 80) || 'Preventive',
    owner: optionalString(data.owner, 'Owner', 120) || actorName,
    targetDate: optionalString(data.targetDate, 'Target date', 40) || String(existing.targetCompletionDate || ''),
    status: optionalString(data.status, 'Status', 40) || 'Open',
    effectiveness: optionalString(data.effectiveness, 'Effectiveness', 40) || 'Pending',
  };

  const priorControls = Array.isArray(existing.controls) ? existing.controls as RiskControlRecord[] : [];
  const now = new Date().toISOString();
  const updates = {
    controls: [...priorControls, control],
    workflowStatus: 'Mitigation',
    riskStatus: 'Mitigation In Progress',
    missingControls: false,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeRiskControl(batch, firestore, id, String(existing.riskNumber || ''), control, actorUid, now);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: 'Mitigation Added', description: `Added control ${control.controlId}`,
    newValue: control, reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const recordEffectivenessAdminRiskAssessment = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Effectiveness check recorded');
  const statusRaw = requiredString(data.effectivenessStatus, 'Effectiveness status', 40);
  if (!EFFECTIVENESS_STATUSES.includes(statusRaw as typeof EFFECTIVENESS_STATUSES[number])) {
    throw new HttpsError('invalid-argument', `Invalid effectiveness status: ${statusRaw}`);
  }
  const effectivenessStatus = statusRaw as typeof EFFECTIVENESS_STATUSES[number];

  const { snap, existing } = await loadRecord(firestore, id);
  if (String(existing.riskStatus) === 'Closed') {
    throw new HttpsError('failed-precondition', 'Record is already closed');
  }

  const now = new Date().toISOString();
  let riskStatus = 'Effectiveness Check Pending';
  if (effectivenessStatus === 'Effective') riskStatus = 'Closed';
  else if (effectivenessStatus === 'Not Effective') riskStatus = 'Mitigation In Progress';

  const updates = {
    effectivenessStatus,
    workflowStatus: 'Effectiveness Check',
    riskStatus,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: 'Risk Updated', description: `Effectiveness: ${effectivenessStatus}`,
    oldValue: existing.effectivenessStatus, newValue: effectivenessStatus, reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const closeAdminRiskAssessment = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertCloser(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to close');
  }

  const { snap, existing } = await loadRecord(firestore, id);
  if (String(existing.riskStatus) === 'Closed') {
    throw new HttpsError('failed-precondition', 'Record is already closed');
  }

  const now = new Date().toISOString();
  const updates = {
    riskStatus: 'Closed',
    workflowStatus: 'Closure',
    isLocked: true,
    closedBy: actorName,
    closedDate: now.slice(0, 10),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: 'Risk Closed', description: `Closed ${existing.riskNumber || id}`,
    oldValue: existing.riskStatus, newValue: 'Closed', reason, now, esign: true,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: 'Electronic Signature', description: `Closure e-sign by ${actorName}`,
    reason, now, esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const softDeleteAdminRiskAssessment = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to archive');
  }

  const { snap, existing } = await loadRecord(firestore, id);
  const status = String(existing.riskStatus || '');
  if (status === 'Approved' || status === 'Closed') {
    throw new HttpsError('failed-precondition', 'Cannot delete Approved or Closed risk records');
  }

  const now = new Date().toISOString();
  const updates = {
    isDeleted: true,
    riskStatus: 'Archived',
    deletedAt: now,
    deletedBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: 'Risk Updated', description: 'Soft-deleted risk assessment record',
    reason, now, esign: true,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.riskNumber || ''),
    actionType: 'Electronic Signature', description: `Archive e-sign by ${actorName}`,
    reason, now, esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminRiskAssessmentExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: 'export', actionType: 'Risk Updated',
    description: `Exported ${Number(data.count || 0)} risk assessment records`,
    newValue: { count: Number(data.count || 0), format: optionalString(data.format, 'Format', 40) || 'CSV' },
    reason: optionalString(data.changeReason, 'Change reason', 500) || 'Export', now,
  });
  await batch.commit();
  return { success: true };
});

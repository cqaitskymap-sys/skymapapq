/**
 * CPV Annual Review — privileged Cloud Functions.
 * Server-side assessment, dual audit, e-sign approve, CF-only writes.
 * Hardens the existing Annual CPV Review module (collection: cpv_reviews).
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';
import { assertOperationalCpvProduct } from './cpv-batch-guard';


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

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(n: number, d = 3): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** d) / 10 ** d;
}

const COLLECTION = 'cpv_reviews';
const SECTIONS_COLLECTION = 'cpv_review_sections';
const APPROVALS_COLLECTION = 'cpv_review_approvals';
const MODULE = 'Annual CPV Review';

const CREATE_ROLES = [
  'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
  'qc', 'qc_manager', 'production', 'production_manager',
];
const EDIT_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const APPROVE_ROLES = ['super_admin', 'admin', 'head_qa', 'qa_manager'];
const VIEWER_ROLES = [
  ...CREATE_ROLES, ...EDIT_ROLES, 'viewer', 'auditor', 'engineering', 'engineering_manager',
];

const STATUSES = [
  'Draft', 'Data Collection', 'Generated', 'Under Review', 'Approved', 'Rejected', 'Archived',
] as const;

type OverallProcessStatus = 'In Control' | 'Under Control With Monitoring' | 'Needs Improvement' | 'Not In Control';
type OverallRiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

interface CpvReviewMetrics {
  totalBatchesReviewed: number;
  releasedBatches: number;
  rejectedBatches: number;
  holdBatches: number;
  batchAcceptanceRate: number;
  cppCompliancePct: number;
  cqaCompliancePct: number;
  yieldAverage: number;
  ootCount: number;
  oosCount: number;
  deviationCount: number;
  capaCount: number;
  changeControlCount: number;
  openRiskCount: number;
  highRiskCount: number;
  criticalOpenRiskCount: number;
  criticalOosOpen: number;
  repeatedOot: boolean;
  repeatedDeviation: boolean;
  sterilityEndotoxinFailure: boolean;
  averageCp: number;
  averageCpk: number;
  averagePp: number;
  averagePpk: number;
  sigmaLevel: number;
  overallCompliancePct: number;
  calibrationCompliancePct: number;
  trainingCompliancePct: number;
  maintenanceEffectivenessPct: number;
  supplierPerformancePct: number;
  complaintRate: number;
  capaEffectivenessPct: number;
}

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Annual CPV Review view access required');
  }
}

function assertCreate(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !CREATE_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Annual CPV Review create access required');
  }
}

function assertEdit(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EDIT_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Annual CPV Review edit access required');
  }
}

function assertApprove(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !APPROVE_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Annual CPV Review approve access required');
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
    auditId: `AUD-ACPV-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now, timestamp: input.now, moduleName: 'CPV', subModule: MODULE,
    collectionName: COLLECTION, recordId: input.recordId, documentId: input.recordId,
    documentNumber: input.documentNumber || '', actionType: input.actionType, action: input.actionType,
    actionDescription: input.description, oldValue: input.oldValue ?? null, newValue: input.newValue ?? null,
    reason: input.reason || '', performedBy: input.actorName, userId: input.actorUid, userName: input.actorName,
    electronicSignature: input.esign === true, createdAt: input.now, source: 'cpv-annual-review-admin',
    immutable: true, appendOnly: true,
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: MODULE, action: input.actionType, recordId: input.recordId, description: input.description,
    performedBy: input.actorName, userId: input.actorUid, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: 'cpv-annual-review-admin',
  });
  batch.set(firestore.collection('cpv_audit_trail').doc(), {
    moduleName: MODULE, actionType: input.actionType, actionDescription: input.description,
    recordId: input.recordId, documentNumber: input.documentNumber || '',
    userId: input.actorUid, userName: input.actorName, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: 'cpv-annual-review-admin',
  });
}

function notify(
  firestore: Firestore, batch: WriteBatch,
  input: { targetUid: string; recordId: string; eventName: string; title: string; message: string; now: string },
) {
  batch.set(firestore.collection('notifications').doc(), {
    userId: input.targetUid, title: input.title, message: input.message, type: 'cpv_annual_review',
    eventName: input.eventName, recordId: input.recordId, module: MODULE,
    href: `/cpv/annual-review/${input.recordId}`, read: false, createdAt: input.now,
  });
}

async function loadRecord(firestore: Firestore, id: string) {
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Annual CPV review not found');
  const existing = snap.data() || {};
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Review is archived/deleted');
  return { snap, existing };
}

function isLockedRecord(existing: DocumentData): boolean {
  const status = String(existing.reviewStatus || existing.status || '');
  return existing.isLocked === true || status === 'Approved' || status === 'Archived';
}

function enrichMetrics(partial: Record<string, unknown>): CpvReviewMetrics {
  const totalBatches = num(partial.totalBatchesReviewed);
  const released = num(partial.releasedBatches);
  const rejected = num(partial.rejectedBatches);
  const hold = num(partial.holdBatches);
  const batchAcceptanceRate = totalBatches > 0
    ? round((released / totalBatches) * 100, 1)
    : num(partial.batchAcceptanceRate);
  const cpp = num(partial.cppCompliancePct, 100);
  const cqa = num(partial.cqaCompliancePct, 100);
  const averageCpk = num(partial.averageCpk);
  const averagePpk = num(partial.averagePpk);
  const averageCp = num(partial.averageCp, averageCpk);
  const averagePp = num(partial.averagePp, averagePpk);
  const sigmaLevel = averageCpk > 0
    ? round(Math.min(6, Math.max(0, 0.5 + averageCpk * 1.5)), 2)
    : num(partial.sigmaLevel);
  return {
    totalBatchesReviewed: totalBatches,
    releasedBatches: released,
    rejectedBatches: rejected,
    holdBatches: hold,
    batchAcceptanceRate,
    cppCompliancePct: cpp,
    cqaCompliancePct: cqa,
    yieldAverage: num(partial.yieldAverage),
    ootCount: num(partial.ootCount),
    oosCount: num(partial.oosCount),
    deviationCount: num(partial.deviationCount),
    capaCount: num(partial.capaCount),
    changeControlCount: num(partial.changeControlCount),
    openRiskCount: num(partial.openRiskCount),
    highRiskCount: num(partial.highRiskCount),
    criticalOpenRiskCount: num(partial.criticalOpenRiskCount),
    criticalOosOpen: num(partial.criticalOosOpen),
    repeatedOot: Boolean(partial.repeatedOot),
    repeatedDeviation: Boolean(partial.repeatedDeviation),
    sterilityEndotoxinFailure: Boolean(partial.sterilityEndotoxinFailure),
    averageCp, averageCpk, averagePp, averagePpk, sigmaLevel,
    overallCompliancePct: round((cpp + cqa) / 2, 1),
    calibrationCompliancePct: num(partial.calibrationCompliancePct, 100),
    trainingCompliancePct: num(partial.trainingCompliancePct, 100),
    maintenanceEffectivenessPct: num(partial.maintenanceEffectivenessPct, 100),
    supplierPerformancePct: num(partial.supplierPerformancePct, 100),
    complaintRate: num(partial.complaintRate),
    capaEffectivenessPct: num(partial.capaEffectivenessPct, 100),
  };
}

function computeOverallAssessment(metrics: CpvReviewMetrics): {
  overallProcessStatus: OverallProcessStatus;
  overallRiskLevel: OverallRiskLevel;
} {
  if (metrics.criticalOosOpen || metrics.criticalOpenRiskCount > 0 || metrics.sterilityEndotoxinFailure) {
    return { overallProcessStatus: 'Not In Control', overallRiskLevel: 'Critical' };
  }
  if (metrics.averageCpk < 1.33 || metrics.repeatedOot || metrics.highRiskCount > 0 || metrics.repeatedDeviation) {
    return {
      overallProcessStatus: 'Needs Improvement',
      overallRiskLevel: metrics.highRiskCount > 0 || metrics.repeatedDeviation ? 'High' : 'Medium',
    };
  }
  if (
    metrics.cppCompliancePct >= 95
    && metrics.cqaCompliancePct >= 95
    && metrics.criticalOpenRiskCount === 0
    && metrics.averageCpk >= 1.33
    && !metrics.criticalOosOpen
  ) {
    return { overallProcessStatus: 'In Control', overallRiskLevel: 'Low' };
  }
  return { overallProcessStatus: 'Under Control With Monitoring', overallRiskLevel: 'Medium' };
}

function computeProcessHealthScore(metrics: CpvReviewMetrics): number {
  let score = 100;
  if (metrics.cppCompliancePct < 95) score -= 10;
  if (metrics.cqaCompliancePct < 95) score -= 10;
  if (metrics.averageCpk < 1.33) score -= 15;
  if (metrics.averageCpk > 0 && metrics.averageCpk < 1.0) score -= 10;
  if (metrics.oosCount > 0) score -= Math.min(20, metrics.oosCount * 5);
  if (metrics.ootCount > 3) score -= 8;
  if (metrics.openRiskCount > 0) score -= 5;
  if (metrics.highRiskCount > 0) score -= 10;
  if (metrics.criticalOpenRiskCount > 0) score -= 25;
  if (metrics.batchAcceptanceRate > 0 && metrics.batchAcceptanceRate < 95) score -= 8;
  if (metrics.calibrationCompliancePct < 95) score -= 5;
  if (metrics.trainingCompliancePct < 95) score -= 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function computeAiInsights(
  metrics: CpvReviewMetrics,
  assessment: { overallProcessStatus: OverallProcessStatus; overallRiskLevel: OverallRiskLevel },
) {
  const processHealthScore = computeProcessHealthScore(metrics);
  const complianceScore = Math.round(metrics.overallCompliancePct);
  const productHealthScore = Math.max(
    0,
    Math.min(100, Math.round((processHealthScore + complianceScore + Math.min(100, metrics.batchAcceptanceRate || 100)) / 3)),
  );
  let riskScore = 15;
  if (assessment.overallRiskLevel === 'Critical') riskScore = 95;
  else if (assessment.overallRiskLevel === 'High') riskScore = 75;
  else if (assessment.overallRiskLevel === 'Medium') riskScore = 45;
  if (metrics.oosCount > 2) riskScore = Math.min(100, riskScore + 10);
  if (metrics.repeatedDeviation) riskScore = Math.min(100, riskScore + 8);

  const capabilityReductionDetected = metrics.averageCpk > 0 && metrics.averageCpk < 1.33;
  const negativeTrendDetected = metrics.repeatedOot || metrics.oosCount > 0 || metrics.deviationCount > 5;
  const escalationRequired = assessment.overallRiskLevel === 'Critical'
    || assessment.overallProcessStatus === 'Not In Control'
    || metrics.criticalOpenRiskCount > 0;

  const confidenceScore = Math.max(
    45,
    Math.min(
      99,
      55
      + (metrics.totalBatchesReviewed >= 10 ? 15 : metrics.totalBatchesReviewed >= 3 ? 8 : 0)
      + (metrics.averageCpk > 0 ? 10 : 0)
      + (metrics.cppCompliancePct > 0 ? 5 : 0),
    ),
  );

  const tips: string[] = [];
  if (capabilityReductionDetected) tips.push('Investigate capability reduction and verify control strategy.');
  if (metrics.oosCount > 0) tips.push('Link OOS events to deviation/CAPA effectiveness checks.');
  if (metrics.repeatedDeviation) tips.push('Repeated deviations detected — initiate risk assessment.');
  if (metrics.calibrationCompliancePct < 95) tips.push('Close calibration compliance gaps.');
  if (metrics.trainingCompliancePct < 95) tips.push('Address training compliance gaps before next campaign.');
  if (!tips.length) tips.push('Continue approved CPV plan; schedule next annual review.');

  return {
    processHealthScore,
    productHealthScore,
    complianceScore,
    confidenceScore,
    riskScore,
    aiExecutiveSummary: [
      `Annual process health ${processHealthScore}% (${assessment.overallProcessStatus}).`,
      `CPP/CQA compliance ${metrics.cppCompliancePct.toFixed(1)}% / ${metrics.cqaCompliancePct.toFixed(1)}%.`,
      metrics.averageCpk > 0 ? `Mean Cpk ${metrics.averageCpk.toFixed(2)} (σ≈${metrics.sigmaLevel.toFixed(1)}).` : 'Capability data limited.',
      `Risk posture: ${assessment.overallRiskLevel}.`,
    ].join(' '),
    aiQualityReview: [
      `Batch acceptance ${metrics.batchAcceptanceRate || 0}%; OOS ${metrics.oosCount}; OOT ${metrics.ootCount}; deviations ${metrics.deviationCount}; CAPA ${metrics.capaCount}.`,
      metrics.yieldAverage > 0 ? `Average yield ${metrics.yieldAverage.toFixed(1)}%.` : '',
    ].filter(Boolean).join(' '),
    aiRiskPrediction: escalationRequired
      ? 'Elevated residual risk — escalate to management review and consider CAPA/change control.'
      : capabilityReductionDetected
        ? 'Capability trending below target — intensify CPP/CQA monitoring and trend review.'
        : 'Residual risk within acceptance for continued Stage 3 CPV monitoring.',
    aiPreventiveRecommendations: tips.join(' '),
    capabilityReductionDetected,
    negativeTrendDetected,
    escalationRequired,
  };
}

function defaultSignatures(actorName: string, actorUid: string, now: string) {
  return [
    {
      role: 'prepared', designation: 'Prepared By', name: actorName, signatureText: actorName,
      meaning: 'Prepared annual CPV review', reason: 'Initial generation', signedAt: now, userId: actorUid, status: 'Signed',
    },
    {
      role: 'reviewed', designation: 'Reviewed By', name: '', signatureText: '',
      meaning: 'Reviewed annual CPV review', reason: '', signedAt: null, userId: '', status: 'Pending',
    },
    {
      role: 'approved', designation: 'Approved By', name: '', signatureText: '',
      meaning: 'Approved annual CPV review', reason: '', signedAt: null, userId: '', status: 'Pending',
    },
  ];
}

function buildSections(reviewId: string, snapshot: Record<string, unknown>) {
  const keys: Array<{ key: string; title: string; content: string }> = [
    { key: 'executiveSummary', title: '1. Executive Summary', content: String(snapshot.executiveSummary || '') },
    { key: 'productBatchSummary', title: '2. Product and Batch Summary', content: String((snapshot.batches as DocumentData)?.summary || '') },
    { key: 'cppReview', title: '3. CPP Review', content: String((snapshot.cpp as DocumentData)?.summary || '') },
    { key: 'cqaReview', title: '4. CQA Review', content: String((snapshot.cqa as DocumentData)?.summary || '') },
    { key: 'rawMaterialReview', title: '5. Raw Material Review', content: String((snapshot.rawMaterial as DocumentData)?.summary || '') },
    { key: 'packingMaterialReview', title: '6. Packing Material Review', content: String((snapshot.packingMaterial as DocumentData)?.summary || '') },
    { key: 'utilityReview', title: '7. Utility Review', content: String((snapshot.utility as DocumentData)?.summary || '') },
    { key: 'environmentalReview', title: '8. Environmental Review', content: String((snapshot.environmental as DocumentData)?.summary || '') },
    { key: 'yieldReview', title: '9. Yield Review', content: String((snapshot.yield as DocumentData)?.summary || '') },
    { key: 'stabilityReview', title: '10. Stability Review', content: String((snapshot.stability as DocumentData)?.summary || '') },
    { key: 'holdTimeReview', title: '11. Hold Time Review', content: String((snapshot.holdTime as DocumentData)?.summary || '') },
    { key: 'processCapabilityReview', title: '12. Process Capability Review', content: String((snapshot.processCapability as DocumentData)?.summary || '') },
    { key: 'trendAnalysisReview', title: '13. Trend Analysis Review', content: String((snapshot.trendAnalysis as DocumentData)?.summary || '') },
    { key: 'spcReview', title: '14. Statistical Process Control Review', content: String((snapshot.spc as DocumentData)?.summary || '') },
    { key: 'riskAssessmentSummary', title: '15. Risk Assessment Summary', content: String((snapshot.risk as DocumentData)?.summary || '') },
    { key: 'deviationReview', title: '16. Deviation Review', content: String((snapshot.deviations as DocumentData)?.summary || '') },
    { key: 'oosReview', title: '17. OOS Review', content: String((snapshot.oos as DocumentData)?.summary || '') },
    { key: 'capaReview', title: '18. CAPA Review', content: String((snapshot.capa as DocumentData)?.summary || '') },
    { key: 'changeControlReview', title: '19. Change Control Review', content: String((snapshot.changeControl as DocumentData)?.summary || '') },
    { key: 'recommendations', title: '20. Recommendations', content: String(snapshot.recommendations || '') },
    { key: 'finalConclusion', title: '21. Final Conclusion', content: String(snapshot.conclusion || '') },
    { key: 'approvalPage', title: '22. Approval Page', content: 'Electronic signatures and approval page.' },
  ];
  return keys.map((k) => ({
    cpvReviewId: reviewId,
    sectionKey: k.key,
    sectionTitle: k.title,
    content: k.content,
    summary: k.content.slice(0, 500),
  }));
}

async function buildReviewNumber(firestore: Firestore, year: number): Promise<string> {
  const prefix = `CPV/${year}/`;
  try {
    const snap = await firestore.collection(COLLECTION).orderBy('createdAt', 'desc').limit(200).get();
    let maxSeq = 0;
    snap.docs.forEach((doc) => {
      const rn = String(doc.data()?.cpvReviewNumber || '');
      if (rn.startsWith(prefix)) {
        const seq = parseInt(rn.slice(prefix.length), 10);
        if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
      }
    });
    return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
  } catch {
    return `${prefix}${String(Math.floor(Date.now() % 9000) + 1000).padStart(4, '0')}`;
  }
}

function sanitizeForm(data: Record<string, unknown>, existing?: DocumentData) {
  const productName = requiredString(data.productName ?? existing?.productName, 'Product name', 200);
  const reviewPeriodFrom = requiredString(data.reviewPeriodFrom ?? existing?.reviewPeriodFrom, 'Review period from', 40);
  const reviewPeriodTo = requiredString(data.reviewPeriodTo ?? existing?.reviewPeriodTo, 'Review period to', 40);
  if (new Date(reviewPeriodTo) < new Date(reviewPeriodFrom)) {
    throw new HttpsError('invalid-argument', 'Review period end must be on or after start date');
  }
  return {
    cpvProductId: optionalString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),
    productName,
    productCode: optionalString(data.productCode ?? existing?.productCode, 'Product code', 80),
    productFamily: optionalString(data.productFamily ?? existing?.productFamily, 'Product family', 120),
    productVersion: optionalString(data.productVersion ?? existing?.productVersion, 'Product version', 40),
    genericName: optionalString(data.genericName ?? existing?.genericName, 'Generic name', 200),
    strength: optionalString(data.strength ?? existing?.strength, 'Strength', 80),
    dosageForm: optionalString(data.dosageForm ?? existing?.dosageForm, 'Dosage form', 80),
    site: optionalString(data.site ?? existing?.site, 'Site', 120),
    plant: optionalString(data.plant ?? existing?.plant, 'Plant', 120),
    department: optionalString(data.department ?? existing?.department, 'Department', 120),
    batchRange: optionalString(data.batchRange ?? existing?.batchRange, 'Batch range', 200),
    manufacturingCampaign: optionalString(data.manufacturingCampaign ?? existing?.manufacturingCampaign, 'Campaign', 120),
    reviewPeriodFrom,
    reviewPeriodTo,
    reviewOwner: optionalString(data.reviewOwner ?? existing?.reviewOwner, 'Review owner', 120),
    effectiveDate: optionalString(data.effectiveDate ?? existing?.effectiveDate, 'Effective date', 40),
    nextReviewDate: optionalString(data.nextReviewDate ?? existing?.nextReviewDate, 'Next review date', 40),
    version: optionalString(data.version ?? existing?.version, 'Version', 20) || '1.0',
    description: optionalString(data.description ?? existing?.description, 'Description', 2000),
    executiveSummary: optionalString(data.executiveSummary ?? existing?.executiveSummary, 'Executive summary', 8000),
    conclusion: optionalString(data.conclusion ?? existing?.conclusion, 'Conclusion', 8000),
    recommendations: optionalString(data.recommendations ?? existing?.recommendations, 'Recommendations', 8000),
  };
}

function emitAlerts(
  firestore: Firestore,
  batch: WriteBatch,
  actorUid: string,
  recordId: string,
  reviewNumber: string,
  metrics: CpvReviewMetrics,
  ai: ReturnType<typeof computeAiInsights>,
  now: string,
) {
  if (ai.escalationRequired) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, now,
      eventName: 'Executive Alert',
      title: 'Annual CPV Review — Escalation',
      message: `${reviewNumber}: ${ai.aiRiskPrediction}`,
    });
  }
  if (ai.capabilityReductionDetected) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, now,
      eventName: 'Capability Reduction',
      title: 'Capability Reduction Detected',
      message: `${reviewNumber}: Mean Cpk ${metrics.averageCpk.toFixed(2)} below target.`,
    });
  }
  if (metrics.oosCount > 0) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId, now,
      eventName: 'OOS Increase',
      title: 'OOS Events in Annual Review',
      message: `${reviewNumber}: ${metrics.oosCount} OOS event(s) in review period.`,
    });
  }
}

export const createAdminCpvAnnualReview = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertCreate(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);
  const cpvProductId = requiredString(data.cpvProductId, 'CPV product', 120);
  const product = await assertOperationalCpvProduct(firestore, cpvProductId);
  const form = sanitizeForm(data);
  form.cpvProductId = cpvProductId;
  form.productName = String(product.productName || form.productName);
  form.productCode = String(product.productCode || form.productCode);
  const snapshot = (data.snapshot && typeof data.snapshot === 'object')
    ? data.snapshot as Record<string, unknown>
    : {};
  const rawMetrics = (snapshot.metrics && typeof snapshot.metrics === 'object')
    ? snapshot.metrics as Record<string, unknown>
    : {};
  const metrics = enrichMetrics({
    ...rawMetrics,
    averageCpk: rawMetrics.averageCpk ?? data.averageCpk,
    averagePpk: rawMetrics.averagePpk ?? data.averagePpk,
  });
  if (metrics.totalBatchesReviewed < 1 && num((snapshot.batches as DocumentData)?.total) < 1) {
    throw new HttpsError('failed-precondition', 'At least one batch is required for review');
  }

  const assessment = computeOverallAssessment(metrics);
  const aiInsights = computeAiInsights(metrics, assessment);
  const year = new Date(form.reviewPeriodTo).getFullYear();
  const cpvReviewNumber = await buildReviewNumber(firestore, year);
  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const cpvReviewId = `CPV-REV-${(form.productCode || 'ALL').replace(/\s+/g, '-').toUpperCase()}-${Date.now()}`;
  const sections = buildSections(ref.id, {
    ...snapshot,
    executiveSummary: form.executiveSummary || String(snapshot.executiveSummary || aiInsights.aiExecutiveSummary),
    conclusion: form.conclusion || String(snapshot.conclusion || ''),
    recommendations: form.recommendations || String(snapshot.recommendations || aiInsights.aiPreventiveRecommendations),
  });

  const record = {
    ...form,
    id: ref.id,
    cpvReviewId,
    cpvReviewNumber,
    reviewYear: year,
    totalBatchesReviewed: metrics.totalBatchesReviewed,
    totalCppParametersReviewed: num((snapshot.cpp as DocumentData)?.total),
    totalCqaParametersReviewed: num((snapshot.cqa as DocumentData)?.total),
    totalDeviations: metrics.deviationCount,
    totalOos: metrics.oosCount,
    totalCapa: metrics.capaCount,
    totalChangeControls: metrics.changeControlCount,
    averageCpk: metrics.averageCpk,
    averagePpk: metrics.averagePpk,
    overallProcessStatus: assessment.overallProcessStatus,
    overallRiskLevel: assessment.overallRiskLevel,
    processHealthScore: aiInsights.processHealthScore,
    productHealthScore: aiInsights.productHealthScore,
    complianceScore: aiInsights.complianceScore,
    confidenceScore: aiInsights.confidenceScore,
    riskScore: aiInsights.riskScore,
    aiInsights,
    executiveSummary: form.executiveSummary || String(snapshot.executiveSummary || aiInsights.aiExecutiveSummary),
    conclusion: form.conclusion || String(snapshot.conclusion || ''),
    recommendations: form.recommendations || String(snapshot.recommendations || aiInsights.aiPreventiveRecommendations),
    preparedBy: actorName,
    reviewedBy: '',
    approvedBy: '',
    approvalDate: '',
    reviewStatus: 'Generated' as const,
    isLocked: false,
    metrics,
    snapshot: {
      ...snapshot,
      metrics,
      overallProcessStatus: assessment.overallProcessStatus,
      overallRiskLevel: assessment.overallRiskLevel,
      aiInsights,
    },
    sections,
    signatures: defaultSignatures(actorName, actorUid, now),
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
  sections.forEach((section) => {
    const sref = firestore.collection(SECTIONS_COLLECTION).doc();
    batch.set(sref, {
      ...section,
      id: sref.id,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUid,
      updatedBy: actorUid,
      isDeleted: false,
    });
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: cpvReviewNumber,
    actionType: 'Review Created', description: `Created ${cpvReviewNumber} health=${aiInsights.processHealthScore}%`,
    newValue: { overallProcessStatus: assessment.overallProcessStatus, overallRiskLevel: assessment.overallRiskLevel },
    reason, now,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: cpvReviewNumber,
    actionType: 'Report Generated', description: `Generated ${sections.length} report sections`,
    newValue: { sectionCount: sections.length }, reason, now,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: cpvReviewNumber,
    actionType: 'AI Summary Generated', description: aiInsights.aiExecutiveSummary.slice(0, 500),
    newValue: aiInsights, reason, now,
  });
  emitAlerts(firestore, batch, actorUid, ref.id, cpvReviewNumber, metrics, aiInsights, now);
  await batch.commit();
  return record;
});

export const updateAdminCpvAnnualReview = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;

  const { snap, existing } = await loadRecord(firestore, id);
  if (isLockedRecord(existing)) {
    if (!qaOverride) throw new HttpsError('failed-precondition', 'Approved/Archived review is locked. QA override required.');
    assertApprove(actor, actorRole);
    if (data.esignConfirmed !== true) {
      throw new HttpsError('failed-precondition', 'Electronic signature required for QA override');
    }
  } else {
    assertEdit(actor, actorRole);
  }

  const form = sanitizeForm(data, existing);
  const metrics = enrichMetrics((existing.metrics || {}) as Record<string, unknown>);
  const assessment = computeOverallAssessment(metrics);
  const aiInsights = computeAiInsights(metrics, assessment);
  const now = new Date().toISOString();

  const updates = {
    ...form,
    processHealthScore: aiInsights.processHealthScore,
    productHealthScore: aiInsights.productHealthScore,
    complianceScore: aiInsights.complianceScore,
    confidenceScore: aiInsights.confidenceScore,
    riskScore: aiInsights.riskScore,
    aiInsights,
    isLocked: qaOverride ? false : existing.isLocked === true,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.cpvReviewNumber || ''),
    actionType: 'Review Updated', description: qaOverride ? `QA override update by ${actorName}` : `Updated ${existing.cpvReviewNumber}`,
    oldValue: { executiveSummary: existing.executiveSummary, conclusion: existing.conclusion },
    newValue: { executiveSummary: updates.executiveSummary, conclusion: updates.conclusion },
    reason, now, esign: qaOverride,
  });
  if (qaOverride) {
    writeAudit(batch, firestore, {
      actorUid, actorName, recordId: id, documentNumber: String(existing.cpvReviewNumber || ''),
      actionType: 'Electronic Signature', description: `QA override e-sign by ${actorName}`,
      reason, now, esign: true,
    });
  }
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const submitAdminCpvAnnualReview = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEdit(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for management approval');
  const { snap, existing } = await loadRecord(firestore, id);
  if (isLockedRecord(existing)) {
    throw new HttpsError('failed-precondition', 'Approved/Archived reviews cannot be submitted');
  }
  if (!String(existing.executiveSummary || '').trim()) {
    throw new HttpsError('failed-precondition', 'Executive summary is required before submission');
  }
  const now = new Date().toISOString();
  const signatures = Array.isArray(existing.signatures) ? [...existing.signatures] : defaultSignatures(actorName, actorUid, now);
  const nextSignatures = signatures.map((s: DocumentData) =>
    s.role === 'reviewed'
      ? {
        ...s,
        name: actorName,
        signatureText: optionalString(data.signatureText, 'Signature', 200) || actorName,
        meaning: optionalString(data.meaning, 'Meaning', 200) || 'review',
        reason,
        signedAt: now,
        userId: actorUid,
        status: 'Signed',
      }
      : s,
  );
  const updates = {
    reviewStatus: 'Under Review',
    reviewedBy: actorName,
    signatures: nextSignatures,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.cpvReviewNumber || ''),
    actionType: 'Review Submitted', description: `Submitted ${existing.cpvReviewNumber} for approval`,
    oldValue: existing.reviewStatus, newValue: 'Under Review', reason, now,
  });
  notify(firestore, batch, {
    targetUid: actorUid, recordId: id, now,
    eventName: 'Management Approval Pending',
    title: 'Annual CPV Review Pending Approval',
    message: `${existing.cpvReviewNumber} is pending management approval.`,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminCpvAnnualReview = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertApprove(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || data.reason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required for approval');
  }
  const { snap, existing } = await loadRecord(firestore, id);
  if (String(existing.reviewStatus) === 'Approved') {
    throw new HttpsError('failed-precondition', 'Review is already approved');
  }
  if (!String(existing.conclusion || '').trim()) {
    throw new HttpsError('failed-precondition', 'Conclusion is required before approval');
  }
  const now = new Date().toISOString();
  const signatureText = requiredString(data.signatureText || actorName, 'Signature', 200);
  const meaning = optionalString(data.meaning, 'Meaning', 200) || 'approve';
  const signatures = Array.isArray(existing.signatures) ? [...existing.signatures] : defaultSignatures(actorName, actorUid, now);
  const nextSignatures = signatures.map((s: DocumentData) =>
    s.role === 'approved'
      ? {
        ...s, name: actorName, signatureText, meaning, reason, signedAt: now, userId: actorUid, status: 'Signed',
      }
      : s,
  );
  const updates = {
    reviewStatus: 'Approved',
    approvedBy: actorName,
    approvalDate: now.slice(0, 10),
    signatures: nextSignatures,
    isLocked: true,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  const approvalRef = firestore.collection(APPROVALS_COLLECTION).doc();
  batch.set(approvalRef, {
    id: approvalRef.id,
    cpvReviewId: id,
    role: 'approved',
    designation: 'Approved By',
    name: actorName,
    signatureText,
    meaning,
    reason,
    signedAt: now,
    userId: actorUid,
    status: 'Approved',
    createdAt: now,
    createdBy: actorUid,
    isDeleted: false,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.cpvReviewNumber || ''),
    actionType: 'Review Approved', description: `Approved ${existing.cpvReviewNumber}`,
    oldValue: existing.reviewStatus, newValue: 'Approved', reason, now, esign: true,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.cpvReviewNumber || ''),
    actionType: 'Electronic Signature', description: `Approval e-sign by ${actorName}`,
    reason, now, esign: true,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.cpvReviewNumber || ''),
    actionType: 'Management Approval', description: `Management approval recorded for ${existing.cpvReviewNumber}`,
    reason, now, esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const rejectAdminCpvAnnualReview = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertApprove(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Rejected by approver');
  const { snap, existing } = await loadRecord(firestore, id);
  if (isLockedRecord(existing) && String(existing.reviewStatus) === 'Approved') {
    throw new HttpsError('failed-precondition', 'Approved reviews cannot be rejected without QA override path');
  }
  const now = new Date().toISOString();
  const updates = {
    reviewStatus: 'Rejected',
    isLocked: false,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.cpvReviewNumber || ''),
    actionType: 'Review Updated', description: `Rejected ${existing.cpvReviewNumber}`,
    oldValue: existing.reviewStatus, newValue: 'Rejected', reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const archiveAdminCpvAnnualReview = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertApprove(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Archived after approval');
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required for archive');
  }
  const { snap, existing } = await loadRecord(firestore, id);
  if (String(existing.reviewStatus) !== 'Approved') {
    throw new HttpsError('failed-precondition', 'Only approved reviews can be archived');
  }
  const now = new Date().toISOString();
  const updates = {
    reviewStatus: 'Archived',
    isLocked: true,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.cpvReviewNumber || ''),
    actionType: 'Review Updated', description: `Archived ${existing.cpvReviewNumber}`,
    oldValue: existing.reviewStatus, newValue: 'Archived', reason, now, esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const softDeleteAdminCpvAnnualReview = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertApprove(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Annual CPV review not found');
  const existing = snap.data() || {};
  const now = new Date().toISOString();
  const updates = {
    isDeleted: true,
    isLocked: true,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.cpvReviewNumber || ''),
    actionType: 'Review Updated', description: `Soft-deleted ${existing.cpvReviewNumber}`,
    reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const logAdminCpvAnnualReviewExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const exportType = optionalString(data.exportType, 'Export type', 40) || 'PDF';
  const documentNumber = optionalString(data.documentNumber, 'Document number', 80);
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber,
    actionType: 'Report Generated', description: `Exported Annual CPV Review as ${exportType}`,
    newValue: { exportType }, reason: 'Export', now,
  });
  await batch.commit();
  return { ok: true };
});

export const STATUSES_EXPORT = STATUSES;

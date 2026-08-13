/**
 * CPV Reports & Analytics — privileged Cloud Functions.
 * Persists aggregated report payloads, dual audit, e-sign archive, CF-only writes.
 * Hardens the existing Reports module (collections: reports, report_exports).
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';


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

const COLLECTION = 'reports';
const EXPORTS_COLLECTION = 'report_exports';
const MODULE = 'CPV Reports & Analytics';

const GENERATE_ROLES = [
  'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
  'qc', 'qc_manager', 'production', 'production_manager',
  'engineering', 'engineering_manager',
];
const EXPORT_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'auditor'];
const ARCHIVE_ROLES = ['super_admin', 'admin'];
const VIEWER_ROLES = [...GENERATE_ROLES, ...EXPORT_ROLES, 'viewer'];

const REPORT_TYPES = [
  'CPV Dashboard Summary Report', 'Product-wise CPV Report', 'Batch-wise CPV Report',
  'CPP Monitoring Report', 'CQA Monitoring Report', 'Raw Material Monitoring Report',
  'Packing Material Monitoring Report', 'Utility Monitoring Report', 'Environmental Monitoring Report',
  'Yield Monitoring Report', 'Stability Monitoring Report', 'Hold Time Monitoring Report',
  'Process Capability Report', 'Trend Analysis Report', 'Statistical Process Control Report',
  'Risk Assessment Report', 'Annual CPV Review Report', 'OOT/OOS Summary Report',
  'CAPA Linked CPV Report', 'Deviation Linked CPV Report', 'Change Control Report',
  'Training Compliance Report', 'Calibration Compliance Report', 'Maintenance Compliance Report',
  'Supplier Performance Report', 'Complaint Analysis Report', 'AI Insights Report',
  'Compliance Scorecard Report', 'Management Review Report', 'Executive Summary Report',
] as const;

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Reports & Analytics view access required');
  }
}

function assertGenerate(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !GENERATE_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Report generation access required');
  }
}

function assertExport(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EXPORT_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Report export access required');
  }
}

function assertArchive(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ARCHIVE_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Report archive access required');
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
    auditId: `AUD-RPT-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now, timestamp: input.now, moduleName: 'CPV', subModule: MODULE,
    collectionName: COLLECTION, recordId: input.recordId, documentId: input.recordId,
    documentNumber: input.documentNumber || '', actionType: input.actionType, action: input.actionType,
    actionDescription: input.description, oldValue: input.oldValue ?? null, newValue: input.newValue ?? null,
    reason: input.reason || '', performedBy: input.actorName, userId: input.actorUid, userName: input.actorName,
    electronicSignature: input.esign === true, createdAt: input.now, source: 'cpv-reports-admin',
    immutable: true, appendOnly: true,
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: MODULE, action: input.actionType, recordId: input.recordId, description: input.description,
    performedBy: input.actorName, userId: input.actorUid, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: 'cpv-reports-admin',
  });
  batch.set(firestore.collection('cpv_audit_trail').doc(), {
    moduleName: MODULE, actionType: input.actionType, actionDescription: input.description,
    recordId: input.recordId, documentNumber: input.documentNumber || '',
    userId: input.actorUid, userName: input.actorName, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: 'cpv-reports-admin',
  });
}

function notify(
  firestore: Firestore, batch: WriteBatch,
  input: { targetUid: string; recordId: string; eventName: string; title: string; message: string; now: string },
) {
  batch.set(firestore.collection('notifications').doc(), {
    userId: input.targetUid, title: input.title, message: input.message, type: 'cpv_reports',
    eventName: input.eventName, recordId: input.recordId, module: MODULE,
    href: `/cpv/reports-analytics/${input.recordId}`, read: false, createdAt: input.now,
  });
}

async function buildReportNumber(firestore: Firestore, year: number): Promise<string> {
  const prefix = `CPV-RPT/${year}/`;
  try {
    const snap = await firestore.collection(COLLECTION).orderBy('createdAt', 'desc').limit(200).get();
    let maxSeq = 0;
    snap.docs.forEach((doc) => {
      const rn = String(doc.data()?.reportNumber || '');
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

function sanitizeMetrics(raw: unknown) {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    totalBatches: num(m.totalBatches),
    releasedBatches: num(m.releasedBatches),
    rejectedBatches: num(m.rejectedBatches),
    batchAcceptanceRate: num(m.batchAcceptanceRate),
    batchRejectionRate: num(m.batchRejectionRate),
    cppCompliancePct: num(m.cppCompliancePct, 100),
    cqaCompliancePct: num(m.cqaCompliancePct, 100),
    ootCount: num(m.ootCount),
    oosCount: num(m.oosCount),
    deviationCount: num(m.deviationCount),
    capaCount: num(m.capaCount),
    changeControlCount: num(m.changeControlCount),
    averageCp: num(m.averageCp),
    averageCpk: num(m.averageCpk),
    averagePp: num(m.averagePp),
    averagePpk: num(m.averagePpk),
    sigmaLevel: num(m.sigmaLevel),
    averageYield: num(m.averageYield),
    openRiskCount: num(m.openRiskCount),
    highRiskCount: num(m.highRiskCount),
    criticalRiskCount: num(m.criticalRiskCount),
    riskScore: num(m.riskScore),
    cpvCompliancePct: num(m.cpvCompliancePct, 100),
    environmentalCompliancePct: num(m.environmentalCompliancePct, 100),
    utilityCompliancePct: num(m.utilityCompliancePct, 100),
    stabilityCompliancePct: num(m.stabilityCompliancePct, 100),
    spcCompliancePct: num(m.spcCompliancePct, 100),
    trainingCompliancePct: num(m.trainingCompliancePct, 100),
    calibrationCompliancePct: num(m.calibrationCompliancePct, 100),
    maintenanceCompliancePct: num(m.maintenanceCompliancePct, 100),
    supplierPerformancePct: num(m.supplierPerformancePct, 100),
    capaEffectivenessPct: num(m.capaEffectivenessPct, 100),
    dataIntegrityScore: num(m.dataIntegrityScore, 80),
    healthScore: num(m.healthScore, 100),
    healthLabel: optionalString(m.healthLabel, 'Health label', 40) || 'Good',
    productHealthScore: num(m.productHealthScore, 100),
    plantHealthScore: num(m.plantHealthScore, 100),
    complianceScore: num(m.complianceScore, 100),
    confidenceScore: num(m.confidenceScore, 70),
    totalRecords: num(m.totalRecords),
    negativeTrendDetected: Boolean(m.negativeTrendDetected),
    capabilityReductionDetected: Boolean(m.capabilityReductionDetected),
    escalationRequired: Boolean(m.escalationRequired),
  };
}

export const createAdminCpvReport = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertGenerate(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);
  const reportType = requiredString(data.reportType, 'Report type', 120);
  if (!REPORT_TYPES.includes(reportType as typeof REPORT_TYPES[number])) {
    throw new HttpsError('invalid-argument', `Invalid report type: ${reportType}`);
  }
  const productName = requiredString(data.productName, 'Product name', 200);
  const reviewPeriodFrom = requiredString(data.reviewPeriodFrom, 'Review period from', 40);
  const reviewPeriodTo = requiredString(data.reviewPeriodTo, 'Review period to', 40);
  if (new Date(reviewPeriodTo) < new Date(reviewPeriodFrom)) {
    throw new HttpsError('invalid-argument', 'Review period end must be on or after start date');
  }

  const metrics = sanitizeMetrics(data.metrics);
  const aiInsights = (data.aiInsights && typeof data.aiInsights === 'object')
    ? data.aiInsights as Record<string, unknown>
    : {
      aiExecutiveSummary: `Generated ${reportType} with health ${metrics.healthScore}%`,
      aiDailyInsights: `OOS ${metrics.oosCount}; OOT ${metrics.ootCount}`,
      aiTrendPrediction: metrics.negativeTrendDetected ? 'Negative trend detected' : 'Stable trend',
      aiRiskPrediction: metrics.escalationRequired ? 'Escalation recommended' : 'Within acceptance',
      aiPreventiveRecommendations: 'Continue approved CPV monitoring plan.',
      aiConfidenceScore: metrics.confidenceScore,
    };
  const previewRows = Array.isArray(data.previewRows) ? data.previewRows.slice(0, 200) : [];
  const charts = (data.charts && typeof data.charts === 'object') ? data.charts : {};
  const year = new Date(reviewPeriodTo).getFullYear();
  const reportNumber = await buildReportNumber(firestore, year);
  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const productCode = optionalString(data.productCode, 'Product code', 80);

  const record = {
    id: ref.id,
    reportId: `CPV-RPT-${(productCode || 'ALL').replace(/\s+/g, '-').toUpperCase()}-${Date.now()}`,
    reportNumber,
    reportType,
    productName,
    productCode,
    batchNumber: optionalString(data.batchNumber, 'Batch number', 80),
    site: optionalString(data.site, 'Site', 120),
    department: optionalString(data.department, 'Department', 120),
    reviewPeriodFrom,
    reviewPeriodTo,
    generatedBy: actorName,
    generatedDate: now,
    reportStatus: 'Generated',
    exportType: '',
    fileUrl: '',
    fileName: '',
    filtersApplied: data.filtersApplied || {
      reportType, productName, productCode,
      batchNumber: optionalString(data.batchNumber, 'Batch', 80),
      reviewPeriodFrom, reviewPeriodTo,
    },
    totalRecords: metrics.totalRecords || previewRows.length,
    metrics,
    aiInsights,
    previewRows,
    charts,
    remarks: optionalString(data.remarks, 'Remarks', 2000),
    changeReason: reason,
    version: optionalString(data.version, 'Version', 20) || '1.0',
    isLocked: false,
    approvedBy: '',
    approvalDate: '',
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdByName: actorName,
    updatedByName: actorName,
    isDeleted: false,
  };

  const batch = firestore.batch();
  batch.set(ref, record);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: reportNumber,
    actionType: 'Report Created', description: `Created ${reportNumber} (${reportType})`,
    newValue: { reportType, healthScore: metrics.healthScore }, reason, now,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: reportNumber,
    actionType: 'Report Generated', description: `Analytics generated health=${metrics.healthScore}% records=${previewRows.length}`,
    newValue: metrics, reason, now,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: reportNumber,
    actionType: 'AI Analysis Generated', description: String(aiInsights.aiExecutiveSummary || '').slice(0, 500),
    newValue: aiInsights, reason, now,
  });
  if (metrics.escalationRequired) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId: ref.id, now,
      eventName: 'Executive Alert',
      title: 'CPV Report Escalation',
      message: `${reportNumber}: ${String(aiInsights.aiRiskPrediction || 'Escalation required')}`,
    });
  }
  if (metrics.capabilityReductionDetected) {
    notify(firestore, batch, {
      targetUid: actorUid, recordId: ref.id, now,
      eventName: 'Capability Reduction',
      title: 'Capability Reduction in Report',
      message: `${reportNumber}: Mean Cpk ${metrics.averageCpk}`,
    });
  }
  await batch.commit();
  return record;
});

export const exportAdminCpvReport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertExport(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Report export');
  const exportType = requiredString(data.exportType, 'Export type', 40);
  const fileUrl = optionalString(data.fileUrl, 'File URL', 500);
  const fileName = optionalString(data.fileName, 'File name', 200);

  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Report not found');
  const existing = snap.data() || {};
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Report is deleted');

  const now = new Date().toISOString();
  const updates = {
    reportStatus: 'Exported',
    exportType,
    fileUrl,
    fileName,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  const exportRef = firestore.collection(EXPORTS_COLLECTION).doc();
  batch.set(exportRef, {
    id: exportRef.id,
    reportId: id,
    reportNumber: String(existing.reportNumber || ''),
    exportType,
    fileUrl,
    fileName,
    exportedBy: actorName,
    exportedAt: now,
    createdAt: now,
    createdBy: actorUid,
    isDeleted: false,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.reportNumber || ''),
    actionType: 'Report Exported', description: `Exported ${existing.reportNumber} as ${exportType}`,
    newValue: { exportType, fileName }, reason, now,
  });
  notify(firestore, batch, {
    targetUid: actorUid, recordId: id, now,
    eventName: 'Daily Report Ready',
    title: 'CPV Report Exported',
    message: `${existing.reportNumber} exported as ${exportType}`,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const archiveAdminCpvReport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertArchive(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Archived CPV report');
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required for archive');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Report not found');
  const existing = snap.data() || {};
  const now = new Date().toISOString();
  const updates = {
    reportStatus: 'Archived',
    isLocked: true,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.reportNumber || ''),
    actionType: 'Approval Completed', description: `Archived ${existing.reportNumber}`,
    oldValue: existing.reportStatus, newValue: 'Archived', reason, now, esign: true,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.reportNumber || ''),
    actionType: 'Electronic Signature', description: `Archive e-sign by ${actorName}`,
    reason, now, esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const softDeleteAdminCpvReport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertArchive(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Report not found');
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
    actorUid, actorName, recordId: id, documentNumber: String(existing.reportNumber || ''),
    actionType: 'Report Generated', description: `Soft-deleted ${existing.reportNumber}`,
    reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const logAdminCpvReportExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const exportType = optionalString(data.exportType, 'Export type', 40) || 'Download';
  const documentNumber = optionalString(data.documentNumber, 'Document number', 80);
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber,
    actionType: 'Report Exported', description: `Downloaded/exported report as ${exportType}`,
    newValue: { exportType }, reason: optionalString(data.changeReason, 'Reason', 200) || 'Export', now,
  });
  await batch.commit();
  return { ok: true };
});

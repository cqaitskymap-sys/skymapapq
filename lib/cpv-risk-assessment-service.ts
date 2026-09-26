import { limit, orderBy } from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import {
  RISK_ASSESSMENT_COLLECTION,
  RISK_ASSESSMENT_LEGACY,
  buildRiskAssessmentId,
  calculateRiskAssessment,
  generateRiskNumber,
  inferRiskFromSignal,
  isOverdue,
  type RiskAssessmentFormData,
  type RiskAssessmentRecord,
  type RiskControlRecord,
  type RiskReviewRecord,
} from '@/lib/cpv-risk-assessment-records';
import { polishRecommendationText } from '@/lib/ai/client';

export interface RiskAssessmentActor {
  id: string;
  name: string;
  role?: string;
}

function cfErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    const msg = (e as { message: string }).message;
    if (msg.includes('FirebaseError:') || msg.includes('functions/')) {
      const cleaned = msg.replace(/^FirebaseError:\s*/i, '').replace(/^functions\/[\w-]+:\s*/i, '');
      return cleaned || fallback;
    }
    return msg || fallback;
  }
  return fallback;
}

function str(v: unknown, fb = ''): string {
  if (v === null || v === undefined) return fb;
  return String(v);
}

function num(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function bool(v: unknown, fb = false): boolean {
  return typeof v === 'boolean' ? v : fb;
}

function resolveChangeReason(
  primary: unknown,
  fallback: unknown,
  defaultReason: string,
): string {
  const reason = str(primary || fallback, defaultReason);
  return reason.trim().length >= 5 ? reason : '';
}

export function normalizeRiskAssessmentRecord(raw: Record<string, unknown>): RiskAssessmentRecord {
  const productCode = str(raw.productCode || raw.product_code);
  const severity = num(raw.severityScore ?? raw.severity ?? raw.severity_score, 1);
  const occurrence = num(raw.occurrenceScore ?? raw.occurrence ?? raw.likelihood, 1);
  const detection = num(raw.detectionScore ?? raw.detectability ?? raw.detection ?? raw.detection_score, 1);
  const residualSeverity = num(raw.residualSeverity ?? raw.residual_severity, 0);
  const residualOccurrence = num(raw.residualOccurrence ?? raw.residual_occurrence, 0);
  const residualDetection = num(raw.residualDetection ?? raw.residual_detection, 0);
  const calc = calculateRiskAssessment(severity, occurrence, detection, {
    severity: residualSeverity > 0 ? residualSeverity : undefined,
    occurrence: residualOccurrence > 0 ? residualOccurrence : undefined,
    detection: residualDetection > 0 ? residualDetection : undefined,
  });
  const targetCompletionDate = str(
    raw.targetCompletionDate || raw.target_completion_date || raw.dueDate || raw.due_date,
  );
  const riskStatus = str(raw.riskStatus || raw.risk_status || raw.status, 'Open') as RiskAssessmentRecord['riskStatus'];

  return {
    id: str(raw.id),
    riskAssessmentId: str(raw.riskAssessmentId || raw.risk_assessment_id, buildRiskAssessmentId(productCode)),
    riskNumber: str(raw.riskNumber || raw.risk_number || raw.riskId || raw.risk_id, generateRiskNumber(0)),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name || raw.product),
    productCode,
    productVersion: str(raw.productVersion || raw.product_version),
    batchNumber: str(raw.batchNumber || raw.batch_number || raw.batchNo || raw.batch_no),
    title: str(raw.title || raw.riskTitle || raw.risk_title),
    methodology: (str(raw.methodology, 'FMEA') as RiskAssessmentRecord['methodology']),
    riskCategory: (str(raw.riskCategory || raw.risk_category, 'Process Risk') as RiskAssessmentRecord['riskCategory']),
    riskSource: (str(raw.riskSource || raw.risk_source || raw.factor, 'Manual Assessment') as RiskAssessmentRecord['riskSource']),
    processStage: str(raw.processStage || raw.process_stage),
    process: str(raw.process),
    processStep: str(raw.processStep || raw.process_step),
    department: str(raw.department),
    site: str(raw.site),
    equipmentId: str(raw.equipmentId || raw.equipment_id),
    equipmentName: str(raw.equipmentName || raw.equipment_name),
    machine: str(raw.machine),
    material: str(raw.material),
    supplier: str(raw.supplier),
    utility: str(raw.utility),
    environmentalCondition: str(raw.environmentalCondition || raw.environmental_condition),
    parameterType: (str(raw.parameterType || raw.parameter_type, 'CPP') as RiskAssessmentRecord['parameterType']),
    parameterName: str(raw.parameterName || raw.parameter_name),
    riskDescription: str(raw.riskDescription || raw.risk_description || raw.rationale),
    potentialImpact: str(raw.potentialImpact || raw.potential_impact),
    potentialCause: str(raw.potentialCause || raw.potential_cause),
    existingControls: str(raw.existingControls || raw.existing_controls || raw.mitigation),
    severityScore: severity,
    occurrenceScore: occurrence,
    detectionScore: detection,
    residualSeverity,
    residualOccurrence,
    residualDetection,
    rpnScore: num(raw.rpnScore ?? raw.rpn ?? raw.rpn_score, calc.rpnScore),
    riskLevel: str(raw.riskLevel || raw.risk_level, calc.riskLevel) as RiskAssessmentRecord['riskLevel'],
    residualRpn: num(raw.residualRpn ?? raw.residual_rpn, calc.residualRpn),
    residualRiskLevel: str(raw.residualRiskLevel || raw.residual_risk_level, calc.residualRiskLevel),
    riskReductionPercent: num(raw.riskReductionPercent ?? raw.risk_reduction_percent, calc.riskReductionPercent),
    criticality: num(raw.criticality, calc.criticality),
    probability: num(raw.probability, calc.probability),
    impact: num(raw.impact, calc.impact),
    likelihood: num(raw.likelihood, calc.likelihood),
    healthScore: num(raw.healthScore ?? raw.health_score, calc.healthScore),
    confidenceScore: num(raw.confidenceScore ?? raw.confidence_score, calc.confidenceScore),
    aiRecommendation: str(raw.aiRecommendation ?? raw.ai_recommendation, calc.aiRecommendation),
    repeatedRiskDetected: bool(raw.repeatedRiskDetected ?? raw.repeated_risk_detected),
    missingControls: bool(raw.missingControls ?? raw.missing_controls),
    mitigationOverdue: bool(raw.mitigationOverdue ?? raw.mitigation_overdue, isOverdue({
      targetCompletionDate,
      riskStatus,
    } as RiskAssessmentRecord)),
    deviationRequired: bool(raw.deviationRequired ?? raw.deviation_required, calc.deviationRequired),
    sourceReferenceNumber: str(raw.sourceReferenceNumber || raw.source_reference_number),
    reviewFrequency: str(raw.reviewFrequency || raw.review_frequency),
    riskDate: str(raw.riskDate || raw.risk_date),
    assessmentDate: str(raw.assessmentDate || raw.assessment_date || raw.riskDate || raw.risk_date),
    priority: str(raw.priority),
    version: str(raw.version, '1.0'),
    changeReason: str(raw.changeReason ?? raw.change_reason),
    riskStatus,
    workflowStatus: (str(raw.workflowStatus || raw.workflow_status, 'Draft') as RiskAssessmentRecord['workflowStatus']),
    effectivenessStatus: (str(raw.effectivenessStatus || raw.effectiveness_status, 'Pending') as RiskAssessmentRecord['effectivenessStatus']),
    riskOwner: str(raw.riskOwner || raw.risk_owner || raw.owner, 'Unassigned'),
    mitigationAction: str(raw.mitigationAction || raw.mitigation_action || raw.mitigation),
    targetCompletionDate,
    effectivenessCheckRequired: bool(raw.effectivenessCheckRequired ?? raw.effectiveness_check_required, true),
    linkedCapaNumber: str(raw.linkedCapaNumber || raw.linked_capa_number),
    linkedDeviationNumber: str(raw.linkedDeviationNumber || raw.linked_deviation_number),
    linkedOosNumber: str(raw.linkedOosNumber || raw.linked_oos_number),
    linkedChangeControlNumber: str(raw.linkedChangeControlNumber || raw.linked_change_control_number),
    capaSuggested: bool(raw.capaSuggested ?? raw.capa_suggested, calc.capaSuggested),
    isAutoGenerated: bool(raw.isAutoGenerated || raw.is_auto_generated || raw.autoGenerated),
    isLocked: bool(raw.isLocked || raw.is_locked),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    reviewDate: str(raw.reviewDate || raw.review_date),
    approvedBy: str(raw.approvedBy || raw.approved_by),
    approvalDate: str(raw.approvalDate || raw.approval_date),
    closedBy: str(raw.closedBy || raw.closed_by),
    closedDate: str(raw.closedDate || raw.closed_date),
    remarks: str(raw.remarks),
    controls: Array.isArray(raw.controls) ? raw.controls as RiskControlRecord[] : [],
    reviews: Array.isArray(raw.reviews) ? raw.reviews as RiskReviewRecord[] : [],
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: bool(raw.isDeleted),
  };
}

export async function fetchRiskAssessmentRecords(max = 500): Promise<RiskAssessmentRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: RiskAssessmentRecord[] = [];
    try {
      primary = await getRecords<RiskAssessmentRecord>(
        RISK_ASSESSMENT_COLLECTION,
        [orderBy('createdAt', 'desc'), limit(max)],
      );
    } catch {
      primary = await getRecords<RiskAssessmentRecord>(RISK_ASSESSMENT_COLLECTION, [limit(max)]);
    }
    const normalized = primary.map((r) => normalizeRiskAssessmentRecord(r as unknown as Record<string, unknown>));
    if (normalized.length) return normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const legacy of RISK_ASSESSMENT_LEGACY) {
      const rows = await listCpvRecords<Record<string, unknown>>(legacy, max);
      if (rows.length) return rows.map((r) => normalizeRiskAssessmentRecord(r));
    }
    const cpvLegacy = await listCpvRecords<Record<string, unknown>>(CPV_COLLECTIONS.risk, max);
    return cpvLegacy.map((r) => normalizeRiskAssessmentRecord(r));
  } catch (e) {
    console.error('fetchRiskAssessmentRecords failed', e);
    return [];
  }
}

export async function fetchRiskAssessmentById(id: string): Promise<RiskAssessmentRecord | null> {
  const record = await getRecord<RiskAssessmentRecord>(RISK_ASSESSMENT_COLLECTION, id);
  if (record) return normalizeRiskAssessmentRecord(record as unknown as Record<string, unknown>);
  const all = await fetchRiskAssessmentRecords();
  return all.find((r) => r.id === id) ?? null;
}

export async function fetchRiskAssessmentAuditTrail(recordId: string) {
  const { getAuditLogsForRisk } = await import('@/lib/risk-audit-trail-service');
  return getAuditLogsForRisk(recordId);
}

export async function createRiskAssessment(
  form: RiskAssessmentFormData,
  actor: RiskAssessmentActor,
  existingCount = 0,
  options?: { isAutoGenerated?: boolean },
): Promise<{ result: RiskAssessmentRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const changeReason = resolveChangeReason(form.changeReason, null, 'Initial risk assessment creation');
    if (!changeReason) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const calc = calculateRiskAssessment(
      form.severityScore,
      form.occurrenceScore,
      form.detectionScore,
      {
        severity: form.residualSeverity || undefined,
        occurrence: form.residualOccurrence || undefined,
        detection: form.residualDetection || undefined,
      },
    );
    const aiRecommendation = await polishRecommendationText(calc.aiRecommendation, {
      module: 'Risk Assessment',
      riskCategory: form.riskCategory,
      riskLevel: calc.riskLevel,
      rpnScore: calc.rpnScore,
      parameterName: form.parameterName,
      riskDescription: form.riskDescription,
    });
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminRiskAssessment',
    );
    const result = await fn({
      ...form,
      changeReason,
      existingCount,
      isAutoGenerated: Boolean(options?.isAutoGenerated),
      createdByName: actor.name,
      updatedByName: actor.name,
      aiRecommendation,
    });
    return { result: normalizeRiskAssessmentRecord(result.data), error: null };
  } catch (e) {
    console.error('createRiskAssessment failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to save risk assessment.') };
  }
}

export async function updateRiskAssessment(
  id: string,
  updates: Partial<RiskAssessmentFormData & Pick<RiskAssessmentRecord, 'riskStatus' | 'workflowStatus' | 'effectivenessStatus' | 'mitigationAction' | 'linkedCapaNumber' | 'linkedDeviationNumber' | 'linkedOosNumber' | 'linkedChangeControlNumber' | 'controls' | 'reviews'>>,
  actor: RiskAssessmentActor,
  existing: RiskAssessmentRecord,
  qaOverride = false,
  options?: { esignConfirmed?: boolean; changeReason?: string },
): Promise<{ result: RiskAssessmentRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  if (existing.isLocked && !qaOverride) {
    return { result: null, error: 'Record is locked. QA override required.' };
  }
  try {
    const changeReason = resolveChangeReason(
      options?.changeReason ?? updates.changeReason,
      existing.changeReason,
      'Risk assessment updated',
    );
    if (!changeReason) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'updateAdminRiskAssessment',
    );
    const result = await fn({
      id,
      ...updates,
      changeReason,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
      updatedByName: actor.name,
    });
    return { result: normalizeRiskAssessmentRecord(result.data), error: null };
  } catch (e) {
    console.error('updateRiskAssessment failed', e);
    return { result: null, error: cfErrorMessage(e, 'Update failed.') };
  }
}

export async function reviewRiskAssessment(
  id: string,
  actor: RiskAssessmentActor,
  existing: RiskAssessmentRecord,
  comments = '',
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminRiskAssessment',
    );
    const result = await fn({
      id,
      comments,
      changeReason,
      updatedByName: actor.name,
    });
    return { result: normalizeRiskAssessmentRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approveRiskAssessment(
  id: string,
  actor: RiskAssessmentActor,
  existing: RiskAssessmentRecord,
  changeReason?: string,
  options?: { esignConfirmed?: boolean },
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const reason = resolveChangeReason(changeReason, existing.changeReason, 'Approved by QA reviewer');
    if (!reason) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'approveAdminRiskAssessment',
    );
    const result = await fn({
      id,
      changeReason: reason,
      esignConfirmed: true,
      updatedByName: actor.name,
    });
    return { result: normalizeRiskAssessmentRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to approve.') };
  }
}

export async function closeRiskAssessment(
  id: string,
  actor: RiskAssessmentActor,
  existing: RiskAssessmentRecord,
  changeReason?: string,
  options?: { esignConfirmed?: boolean },
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const reason = resolveChangeReason(changeReason, existing.changeReason, 'Risk assessment closed');
    if (!reason) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'closeAdminRiskAssessment',
    );
    const result = await fn({
      id,
      changeReason: reason,
      esignConfirmed: true,
      updatedByName: actor.name,
    });
    return { result: normalizeRiskAssessmentRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to close risk assessment.') };
  }
}

export async function rejectRiskAssessment(
  id: string,
  actor: RiskAssessmentActor,
  existing: RiskAssessmentRecord,
  changeReason = 'Rejected by QA',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'rejectAdminRiskAssessment',
    );
    const result = await fn({
      id,
      changeReason,
      updatedByName: actor.name,
    });
    return { result: normalizeRiskAssessmentRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to reject.') };
  }
}

export async function addRiskControl(
  id: string,
  control: Omit<RiskControlRecord, 'controlId'>,
  actor: RiskAssessmentActor,
  existing: RiskAssessmentRecord,
  changeReason = 'Risk control added',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'addControlAdminRiskAssessment',
    );
    const result = await fn({
      id,
      control,
      changeReason,
      updatedByName: actor.name,
    });
    return { result: normalizeRiskAssessmentRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to add control.') };
  }
}

export async function recordEffectivenessReview(
  id: string,
  status: RiskAssessmentRecord['effectivenessStatus'],
  actor: RiskAssessmentActor,
  existing: RiskAssessmentRecord,
  changeReason = 'Effectiveness review recorded',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'recordEffectivenessAdminRiskAssessment',
    );
    const result = await fn({
      id,
      effectivenessStatus: status,
      changeReason,
      updatedByName: actor.name,
    });
    return { result: normalizeRiskAssessmentRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to record effectiveness review.') };
  }
}

export async function linkRiskRecord(
  id: string,
  field: 'linkedCapaNumber' | 'linkedDeviationNumber' | 'linkedOosNumber' | 'linkedChangeControlNumber',
  value: string,
  actor: RiskAssessmentActor,
  existing: RiskAssessmentRecord,
  changeReason?: string,
) {
  const defaultReason = field.includes('Capa') ? 'Linked CAPA to risk assessment'
    : field.includes('Deviation') ? 'Linked deviation to risk assessment'
      : field.includes('Oos') ? 'Linked OOS to risk assessment'
        : 'Linked change control to risk assessment';
  return updateRiskAssessment(
    id,
    { [field]: value } as Partial<RiskAssessmentRecord>,
    actor,
    existing,
    false,
    { changeReason: changeReason || defaultReason },
  );
}

export async function softDeleteRiskAssessment(
  id: string,
  actor: RiskAssessmentActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
): Promise<{ error: string | null }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { error: 'Change reason (min 5 characters) is required.' };
    }
    if (options?.esignConfirmed !== true) {
      return { error: 'Electronic signature confirmation required.' };
    }
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminRiskAssessment');
    await fn({ id, changeReason, esignConfirmed: true });
    return { error: null };
  } catch (e) {
    return { error: cfErrorMessage(e, 'Failed to archive risk assessment.') };
  }
}

export async function logRiskExport(actor: RiskAssessmentActor, type: string, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminRiskAssessmentExport');
    await fn({ count, format: type || 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logRiskExport CF failed (non-blocking)', e);
  }
}

export async function createAutoRiskFromSignal(
  input: Parameters<typeof inferRiskFromSignal>[0] & Pick<RiskAssessmentFormData, 'productName' | 'productCode' | 'batchNumber' | 'parameterName' | 'riskOwner' | 'targetCompletionDate'>,
  actor: RiskAssessmentActor,
  existingCount: number,
) {
  const inferred = inferRiskFromSignal(input);
  return createRiskAssessment({
    cpvProductId: '',
    productName: input.productName,
    productCode: input.productCode || 'PRD',
    productVersion: '',
    batchNumber: input.batchNumber || '',
    title: input.parameterName || inferred.riskDescription.slice(0, 120),
    methodology: 'FMEA',
    processStage: '',
    process: '',
    processStep: '',
    department: '',
    site: '',
    equipmentId: '',
    equipmentName: '',
    machine: '',
    material: '',
    supplier: '',
    utility: '',
    environmentalCondition: '',
    parameterName: input.parameterName || '',
    parameterType: 'CPP',
    riskOwner: input.riskOwner,
    targetCompletionDate: input.targetCompletionDate,
    assessmentDate: '',
    reviewFrequency: '',
    priority: '',
    version: '1.0',
    mitigationAction: '',
    existingControls: '',
    potentialCause: '',
    residualSeverity: 0,
    residualOccurrence: 0,
    residualDetection: 0,
    linkedCapaNumber: '',
    linkedDeviationNumber: '',
    linkedOosNumber: '',
    linkedChangeControlNumber: '',
    remarks: 'Auto-generated from CPV monitoring signal',
    effectivenessCheckRequired: true,
    changeReason: 'Auto-generated from CPV monitoring signal',
    ...inferred,
  }, actor, existingCount, { isAutoGenerated: true });
}

export const createFromSignal = createAutoRiskFromSignal;

export { inferRiskFromSignal, calculateRiskAssessment, generateRiskNumber };

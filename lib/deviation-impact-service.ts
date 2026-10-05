import {
  collection, doc, addDoc, getDocs, updateDoc, query, where, limit, orderBy,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  computeImpactAutoRules,
  computeRiskLevel,
  computeRiskScore,
  type ImpactAssessmentActor,
  type ImpactFormInput,
} from '@/lib/deviation-impact-records';
import {
  DEVIATION_COLLECTIONS,
  type DeviationImpactAssessment,
  type DeviationRecord,
} from '@/lib/deviation-types';
import { applyOverdueCheck, getDeviationById, getImpactAssessment, updateDeviation } from '@/lib/deviation-service';

export type { ImpactAssessmentActor, ImpactFormInput };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

async function audit(actor: ImpactAssessmentActor, actionType: string, deviationId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: 'Deviation Impact Assessment',
      collectionName: DEVIATION_COLLECTIONS.impactAssessments,
      recordId: deviationId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
  } catch (e) {
    console.error('impact audit', e);
  }
}

const ROLE_RECIPIENTS = new Set(['qa', 'qa_manager', 'head_qa', 'qc', 'qc_manager', 'admin', 'production_manager']);

async function notify(title: string, message: string, deviationId: string, recipient: string) {
  if (!isFirebaseConfigured()) return;
  try {
    const roleTarget = ROLE_RECIPIENTS.has(recipient);
    await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.notifications), {
      title,
      message,
      module: 'Deviation',
      record_id: deviationId,
      ...(roleTarget ? { target_role: recipient } : { user_id: recipient }),
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('impact notify', e);
  }
}

function mapInputToAssessment(
  deviationId: string,
  record: DeviationRecord,
  input: ImpactFormInput,
  actor: ImpactAssessmentActor,
  status: string,
  existing?: DeviationImpactAssessment | null,
): Omit<DeviationImpactAssessment, 'id'> {
  const ts = nowIso();
  const auto = computeImpactAutoRules(input, record);
  const riskScore = computeRiskScore(input.severity, input.occurrence, input.detection);
  const riskLevel = computeRiskLevel(riskScore);

  return {
    deviation_id: deviationId,
    deviation_number: record.deviation_number,
    product: record.product_name,
    batch_number: record.batch_number,
    assessment_date: input.assessment_date || today(),
    assessed_by: actor.id,
    assessed_by_name: input.assessed_by_name || actor.name,
    department: input.department || record.department,
    batch_impact: input.batch_impact,
    product_quality_impact: input.product_quality_impact,
    patient_safety_impact: input.patient_safety_impact,
    regulatory_impact: input.regulatory_impact,
    stability_impact: input.stability_impact,
    validation_impact: input.validation_impact,
    equipment_impact: input.equipment_impact,
    utility_impact: input.utility_impact,
    material_impact: input.material_impact,
    packaging_impact: input.packaging_impact,
    cleaning_impact: input.cleaning_impact,
    documentation_impact: input.documentation_impact,
    training_impact: input.training_impact,
    market_impact: input.market_impact,
    other_batches_impacted: input.other_batches_impacted,
    impacted_batch_numbers: input.impacted_batch_numbers || '',
    impact_description: input.impact_description || '',
    impact_summary: input.impact_summary,
    batch_impact_details: input.batch_impact_details || '',
    product_quality_impact_details: input.product_quality_impact_details || '',
    patient_safety_impact_details: input.patient_safety_impact_details || '',
    regulatory_impact_details: input.regulatory_impact_details || '',
    severity: input.severity,
    occurrence: input.occurrence,
    detection: input.detection,
    risk_score: riskScore,
    risk_level: riskLevel,
    capa_required: input.capa_required || auto.capaRequired,
    capa_justification: input.capa_justification || '',
    recall_evaluation_required: input.recall_evaluation_required || auto.recallEvaluationRequired,
    conclusion: input.conclusion || '',
    qa_comments: input.qa_comments || '',
    status,
    assessed_at: existing?.assessed_at || ts,
    created_at: existing?.created_at || ts,
    updated_at: ts,
    created_by: existing?.created_by || actor.id,
    updated_by: actor.id,
    created_by_name: existing?.created_by_name || actor.name,
    updated_by_name: actor.name,
    is_deleted: false,
  };
}

async function syncDeviationFromImpact(deviationId: string, assessment: Omit<DeviationImpactAssessment, 'id'>, actor: ImpactAssessmentActor) {
  await updateDeviation(deviationId, {
    capa_required: assessment.capa_required,
    batch_impacted: assessment.batch_impact === 'Yes',
    product_quality_impacted: assessment.product_quality_impact === 'Yes',
    patient_safety_impacted: assessment.patient_safety_impact === 'Yes',
    regulatory_impact: assessment.regulatory_impact === 'Yes',
    batch_impact: assessment.batch_impact,
    product_quality_impact: assessment.product_quality_impact,
    patient_safety_impact: assessment.patient_safety_impact,
    regulatory_impact_status: assessment.regulatory_impact,
    risk_assessment: assessment.risk_level === 'Critical' ? 'critical'
      : assessment.risk_level === 'High' ? 'high'
        : assessment.risk_level === 'Medium' ? 'medium' : 'low',
    status: assessment.capa_required ? 'capa_required' : 'qa_review',
  }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, { workflow: true });
}

export async function fetchImpactAssessmentPageData(deviationId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const record = await getDeviationById(deviationId);
    if (!record) return { error: 'Deviation not found.' };
    const impact = await getImpactAssessment(deviationId);
    return { record: applyOverdueCheck(record), impact };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load impact assessment' };
  }
}

export async function listImpactAssessments(max = 100): Promise<(DeviationRecord & { impact?: DeviationImpactAssessment | null })[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations),
      orderBy('updated_at', 'desc'),
      limit(max),
    ));
    const records = snap.docs
      .map((d) => applyOverdueCheck({ id: d.id, ...d.data() } as DeviationRecord))
      .filter((r) => !r.is_deleted && r.status !== 'draft' && r.status !== 'closed');

    return Promise.all(records.map(async (r) => ({
      ...r,
      impact: await getImpactAssessment(r.id),
    })));
  } catch (e) {
    console.error('listImpactAssessments', e);
    return [];
  }
}

export async function saveImpactAssessmentDraft(
  deviationId: string,
  input: ImpactFormInput,
  actor: ImpactAssessmentActor,
): Promise<{ impact?: DeviationImpactAssessment; error?: string }> {
  const record = await getDeviationById(deviationId);
  if (!record) return { error: 'Deviation not found' };

  const auto = computeImpactAutoRules(input, record);
  if (auto.warnings.some((w) => w.includes('impacted batch numbers') && input.other_batches_impacted === 'Yes')) {
    return { error: 'Impacted batch numbers are required when other batches are impacted.' };
  }

  const payload = mapInputToAssessment(deviationId, record, {
    ...input,
    capa_required: input.capa_required || auto.capaRequired,
    recall_evaluation_required: input.recall_evaluation_required || auto.recallEvaluationRequired,
  }, actor, 'Draft');

  try {
    const existing = await getImpactAssessment(deviationId);
    let result: DeviationImpactAssessment;
    if (existing) {
      await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.impactAssessments, existing.id), payload);
      result = { ...existing, ...payload, id: existing.id };
      await audit(actor, 'Impact Assessment Edited', deviationId, `Risk ${payload.risk_score}`);
    } else {
      const ref = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.impactAssessments), payload);
      result = { id: ref.id, ...payload };
      await audit(actor, 'Impact Assessment Created', deviationId);
    }
    await audit(actor, 'Risk Calculation Updated', deviationId, `Score ${payload.risk_score} / ${payload.risk_level}`);
    if (payload.capa_required) await audit(actor, 'CAPA Required Changed', deviationId, 'CAPA mandatory');
    if (payload.recall_evaluation_required) await audit(actor, 'Recall Flag Set', deviationId);
    await syncDeviationFromImpact(deviationId, payload, actor);
    return { impact: result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save draft' };
  }
}

export async function submitImpactAssessment(
  deviationId: string,
  input: ImpactFormInput,
  actor: ImpactAssessmentActor,
): Promise<{ impact?: DeviationImpactAssessment; error?: string }> {
  if (!input.conclusion?.trim()) return { error: 'Conclusion is required before submit' };
  if (!input.assessment_date) return { error: 'Assessment date is required' };
  if (!input.assessed_by_name?.trim()) return { error: 'Assessed by is required' };

  const draft = await saveImpactAssessmentDraft(deviationId, input, actor);
  if (draft.error || !draft.impact) return draft;

  try {
    const payload = { status: 'Submitted', updated_at: nowIso(), updated_by: actor.id, updated_by_name: actor.name };
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.impactAssessments, draft.impact.id), payload);
    await updateDeviation(deviationId, { status: 'qa_review' }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, { workflow: true });
    await audit(actor, 'Impact Assessment Submitted', deviationId);
    await notify('Impact Assessment Submitted', `${draft.impact.deviation_number} impact assessment submitted`, deviationId, 'qa_manager');

    const auto = computeImpactAutoRules(input, await getDeviationById(deviationId) || undefined);
    if (auto.notifyHeadQa) {
      await notify('Patient Safety Impact', `Patient safety impact on ${draft.impact.deviation_number}`, deviationId, 'head_qa');
    }

    return { impact: { ...draft.impact, ...payload } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Submit failed' };
  }
}

export async function reviewImpactAssessment(
  deviationId: string,
  decision: 'approved' | 'rejected',
  qaComments: string,
  actor: ImpactAssessmentActor,
  record: DeviationRecord,
): Promise<{ error?: string }> {
  if (decision === 'rejected' && !qaComments.trim()) return { error: 'QA comments required for rejection' };

  const impact = await getImpactAssessment(deviationId);
  if (!impact) return { error: 'Impact assessment not found' };

  try {
    const status = decision === 'approved' ? 'Approved' : 'Rejected';
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.impactAssessments, impact.id), {
      status,
      qa_comments: qaComments,
      reviewed_by_qa: actor.id,
      reviewed_by_qa_name: actor.name,
      qa_review_date: nowIso(),
      updated_at: nowIso(),
      updated_by: actor.id,
      updated_by_name: actor.name,
    });
    await updateDeviation(deviationId, {
      status: decision === 'approved' ? (impact.capa_required ? 'capa_required' : 'approved') : 'rejected',
      qa_remarks: qaComments,
    }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, { workflow: true });
    await audit(actor, decision === 'approved' ? 'Impact Assessment Approved' : 'Impact Assessment Rejected', deviationId, qaComments);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Review failed' };
  }
}

export function mapImpactToFormInput(
  impact: DeviationImpactAssessment | null,
  record: DeviationRecord,
  actorName: string,
): ImpactFormInput {
  return {
    assessment_date: impact?.assessment_date || today(),
    assessed_by_name: impact?.assessed_by_name || actorName,
    department: impact?.department || record.department,
    batch_impact: impact?.batch_impact || record.batch_impact || (record.batch_impacted ? 'Yes' : 'No'),
    product_quality_impact: impact?.product_quality_impact || (record.product_quality_impacted ? 'Yes' : 'No'),
    patient_safety_impact: impact?.patient_safety_impact || (record.patient_safety_impacted ? 'Yes' : 'No'),
    regulatory_impact: impact?.regulatory_impact || (record.regulatory_impact ? 'Yes' : 'No'),
    stability_impact: impact?.stability_impact || 'Not Applicable',
    validation_impact: impact?.validation_impact || 'Not Applicable',
    equipment_impact: impact?.equipment_impact || 'Not Applicable',
    utility_impact: impact?.utility_impact || 'Not Applicable',
    material_impact: impact?.material_impact || 'Not Applicable',
    packaging_impact: impact?.packaging_impact || 'Not Applicable',
    cleaning_impact: impact?.cleaning_impact || 'Not Applicable',
    documentation_impact: impact?.documentation_impact || 'Not Applicable',
    training_impact: impact?.training_impact || 'Not Applicable',
    market_impact: impact?.market_impact || 'Not Applicable',
    other_batches_impacted: impact?.other_batches_impacted || 'No',
    impacted_batch_numbers: impact?.impacted_batch_numbers || '',
    impact_description: impact?.impact_description || '',
    impact_summary: impact?.impact_summary || '',
    batch_impact_details: impact?.batch_impact_details || '',
    product_quality_impact_details: impact?.product_quality_impact_details || '',
    patient_safety_impact_details: impact?.patient_safety_impact_details || '',
    regulatory_impact_details: impact?.regulatory_impact_details || '',
    severity: impact?.severity || 3,
    occurrence: impact?.occurrence || 3,
    detection: impact?.detection || 3,
    capa_required: impact?.capa_required ?? record.capa_required ?? false,
    capa_justification: impact?.capa_justification || '',
    recall_evaluation_required: impact?.recall_evaluation_required ?? false,
    conclusion: impact?.conclusion || '',
    qa_comments: impact?.qa_comments || '',
  };
}

export { computeImpactAutoRules, computeRiskLevel, computeRiskScore };

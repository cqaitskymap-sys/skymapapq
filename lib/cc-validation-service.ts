import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { normalizeRole } from '@/lib/permissions';
import {
  buildValidationAssessmentId,
  canApproveCcValidation,
  CC_VALIDATION_MODULE,
  computeCcValidationChartData,
  computeCcValidationDashboardMetrics,
  generateValidationDeliverables,
  generateValidationRecommendations,
  requiresHeadQaValidationApproval,
  type CcValidationActor,
  type CcValidationFormInput,
  type CcValidationQaReviewInput,
  validateCcValidationRules,
} from '@/lib/cc-validation-records';
import {
  CC_COLLECTIONS,
  type CcValidationAssessment,
  type CcValidationChartData,
  type CcValidationDashboardMetrics,
  type ChangeControlRecord,
} from '@/lib/change-control-types';
import { polishRecommendationText } from '@/lib/ai/client';
import {
  getAuditLogsForChange,
  getChangeById,
  listChanges,
  updateChange,
} from '@/lib/change-control-service';

export type { CcValidationActor, CcValidationFormInput, CcValidationQaReviewInput };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: CcValidationActor,
  actionType: string,
  changeId: string,
  detail?: string,
  recordId?: string,
) {
  try {
    await createAuditLog({
      moduleName: CC_VALIDATION_MODULE,
      collectionName: CC_COLLECTIONS.validation,
      recordId: recordId || changeId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('cc validation audit', e);
  }
}

async function notify(
  title: string,
  message: string,
  changeId: string,
  opts?: { userId?: string; targetRole?: string },
) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.notifications), {
      title,
      message,
      module: CC_VALIDATION_MODULE,
      record_id: changeId,
      ...(opts?.userId ? { user_id: opts.userId } : {}),
      ...(opts?.targetRole ? { target_role: opts.targetRole } : {}),
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('cc validation notify', e);
  }
}

function normalizeAssessment(docId: string, data: Record<string, unknown>): CcValidationAssessment {
  const a = { id: docId, ...data } as CcValidationAssessment;
  return {
    ...a,
    validation_deliverables: Array.isArray(a.validation_deliverables) ? a.validation_deliverables : [],
    status: a.status || 'Draft',
    is_deleted: a.is_deleted ?? false,
  };
}

async function buildPayload(
  change: ChangeControlRecord,
  input: CcValidationFormInput,
  actor: CcValidationActor,
  existing?: CcValidationAssessment | null,
): Promise<Partial<CcValidationAssessment>> {
  const baseRecs = generateValidationRecommendations(input, change);
  const polishedRecs = await polishRecommendationText(
    input.recommendations || baseRecs.join('\n'),
    {
      module: 'Change Control Validation',
      changeControlNumber: change.change_control_number,
      validationImpact: input.validation_impact,
      csvImpact: input.csv_impact,
      revalidationRequired: input.revalidation_required,
    },
  );
  const deliverables = input.validation_deliverables?.length
    ? input.validation_deliverables
    : generateValidationDeliverables(input);
  const timestamp = nowIso();
  return {
    change_id: change.id,
    change_control_number: change.change_control_number,
    validation_assessment_id: existing?.validation_assessment_id || buildValidationAssessmentId(change.change_control_number),
    assessment_date: input.assessment_date,
    assessed_by: input.assessed_by,
    assessed_by_name: input.assessed_by_name || actor.name,
    department: input.department,
    validation_impact: input.validation_impact,
    qualification_impact: input.qualification_impact,
    csv_impact: input.csv_impact,
    data_integrity_impact: input.data_integrity_impact,
    regulatory_impact: input.regulatory_impact,
    revalidation_required: input.revalidation_required,
    validation_category: input.validation_category,
    system_type: input.system_type,
    affected_system: input.affected_system || change.affected_equipment,
    affected_equipment: input.affected_equipment || change.affected_equipment,
    affected_documents: input.affected_documents || change.affected_documents,
    affected_sops: input.affected_sops,
    affected_process: input.affected_process || change.affected_process,
    validation_scope: input.validation_scope,
    validation_justification: input.validation_justification,
    risk_based_rationale: input.risk_based_rationale,
    validation_deliverables: deliverables,
    validation_owner: input.validation_owner,
    validation_owner_name: input.validation_owner_name || actor.name,
    target_completion_date: input.target_completion_date,
    qa_comments: input.qa_comments || '',
    head_qa_comments: input.head_qa_comments || '',
    gamp_category: input.gamp_category,
    electronic_records_impact: input.electronic_records_impact,
    electronic_signature_impact: input.electronic_signature_impact,
    audit_trail_impact: input.audit_trail_impact,
    security_impact: input.security_impact,
    backup_impact: input.backup_impact,
    disaster_recovery_impact: input.disaster_recovery_impact,
    part_11_impact: input.part_11_impact,
    annex_11_impact: input.annex_11_impact,
    annex_11_review_completed: input.annex_11_review_completed,
    csv_assessment_completed: input.csv_assessment_completed,
    qualification_review_completed: input.qualification_review_completed,
    recommendations: polishedRecs,
    status: existing?.status || 'Draft',
    progress_percent: existing?.progress_percent ?? 15,
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
    created_by: existing?.created_by || actor.id,
    created_by_name: existing?.created_by_name || actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    is_deleted: false,
  };
}

async function syncChangeControlImpact(change: ChangeControlRecord, assessment: CcValidationAssessment) {
  await updateChange(change.id, {
    validation_impact: assessment.validation_impact,
    csv_impact: assessment.csv_impact,
    regulatory_impact: assessment.regulatory_impact,
  }, { id: assessment.updated_by || assessment.assessed_by, name: assessment.assessed_by_name || 'System', role: '' }, true);
}

async function mirrorCsvAssessment(change: ChangeControlRecord, assessment: CcValidationAssessment) {
  if (!isFirebaseConfigured() || !assessment.csv_impact) return;
  try {
    const db = getFirebaseFirestore();
    const snap = await getDocs(query(
      collection(db, CC_COLLECTIONS.csvAssessment),
      where('change_id', '==', change.id),
      limit(1),
    ));
    const payload = {
      change_id: change.id,
      change_control_number: change.change_control_number,
      validation_assessment_id: assessment.validation_assessment_id || assessment.id,
      gamp_category: assessment.gamp_category,
      electronic_records_impact: assessment.electronic_records_impact,
      electronic_signature_impact: assessment.electronic_signature_impact,
      audit_trail_impact: assessment.audit_trail_impact,
      security_impact: assessment.security_impact,
      backup_impact: assessment.backup_impact,
      disaster_recovery_impact: assessment.disaster_recovery_impact,
      part_11_impact: assessment.part_11_impact,
      annex_11_impact: assessment.annex_11_impact,
      status: assessment.status,
      updated_at: nowIso(),
      is_deleted: false,
    };
    if (!snap.empty) {
      await updateDoc(doc(db, CC_COLLECTIONS.csvAssessment, snap.docs[0].id), payload);
    } else {
      await addDoc(collection(db, CC_COLLECTIONS.csvAssessment), {
        ...payload,
        created_at: nowIso(),
      });
    }
  } catch (e) {
    console.error('mirror csv assessment', e);
  }
}

async function runSubmitNotifications(change: ChangeControlRecord, assessment: CcValidationAssessment) {
  if (assessment.validation_owner) {
    await notify(
      'Validation Assessment Submitted',
      `Assessment submitted for QA review — ${change.change_control_number}.`,
      change.id,
      { userId: assessment.validation_owner },
    );
  }
  await notify(
    'Validation Assessment Pending QA',
    `QA review pending for ${change.change_control_number}.`,
    change.id,
    { targetRole: 'qa' },
  );
  if (assessment.csv_impact && !assessment.csv_assessment_completed) {
    await notify(
      'CSV Assessment Required',
      `CSV assessment required for ${change.change_control_number}.`,
      change.id,
      { targetRole: 'csv' },
    );
  }
  if (assessment.data_integrity_impact && !assessment.annex_11_review_completed) {
    await notify(
      'Annex 11 Review Required',
      `Annex 11 review required for ${change.change_control_number}.`,
      change.id,
      { targetRole: 'csv' },
    );
  }
  if (requiresHeadQaValidationApproval(change, assessment)) {
    await notify(
      'Critical Validation Impact',
      `Head QA review will be required for ${change.change_control_number}.`,
      change.id,
      { targetRole: 'head_qa' },
    );
  }
}

export async function getCcValidationAssessment(changeId: string): Promise<CcValidationAssessment | null> {
  if (!isFirebaseConfigured()) return null;
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), CC_COLLECTIONS.validation),
    where('change_id', '==', changeId),
    orderBy('updated_at', 'desc'),
    limit(1),
  ));
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data() as Record<string, unknown>;
  if (data.is_deleted) return null;
  return normalizeAssessment(d.id, data);
}

export async function listCcValidationAssessments(max = 300): Promise<(CcValidationAssessment & { change?: ChangeControlRecord | null })[]> {
  if (!isFirebaseConfigured()) return [];
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), CC_COLLECTIONS.validation),
    orderBy('updated_at', 'desc'),
    limit(max),
  ));
  const changes = await listChanges();
  const changeById = new Map(changes.map((c) => [c.id, c]));
  return snap.docs
    .map((d) => normalizeAssessment(d.id, d.data() as Record<string, unknown>))
    .filter((a) => !a.is_deleted)
    .map((a) => ({ ...a, change: changeById.get(a.change_id) || null }));
}

export async function fetchCcValidationPageData(changeId: string) {
  try {
    const [change, assessment, auditLogs] = await Promise.all([
      getChangeById(changeId),
      getCcValidationAssessment(changeId),
      getAuditLogsForChange(changeId),
    ]);
    if (!change) return { error: 'Change control not found' as const };
    return { change, assessment, auditLogs };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load validation assessment' };
  }
}

export async function fetchCcValidationListData() {
  try {
    const [assessments, changes] = await Promise.all([listCcValidationAssessments(), listChanges()]);
    const metrics = computeCcValidationDashboardMetrics(assessments, changes);
    const charts = computeCcValidationChartData(assessments);
    return { assessments, changes, metrics, charts };
  } catch (e) {
    return {
      assessments: [] as (CcValidationAssessment & { change?: ChangeControlRecord | null })[],
      changes: [] as ChangeControlRecord[],
      metrics: computeCcValidationDashboardMetrics([], []),
      charts: computeCcValidationChartData([]),
      error: e instanceof Error ? e.message : 'Failed to load list',
    };
  }
}

export async function saveCcValidationDraft(
  input: CcValidationFormInput,
  actor: CcValidationActor,
): Promise<{ assessment?: CcValidationAssessment; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase not configured' };
  const change = await getChangeById(input.change_id);
  if (!change) return { error: 'Change control not found' };

  const existing = await getCcValidationAssessment(input.change_id);
  const payload = await buildPayload(change, input, actor, existing);
  let refId = existing?.id;

  if (existing) {
    await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.validation, existing.id), payload);
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.validation), payload);
    refId = ref.id;
    await audit(actor, 'assessment created', change.id, `Assessment created for ${change.change_control_number}`, refId);
  }

  await audit(actor, 'validation impact updated', change.id, `Category: ${payload.validation_category}`, refId);
  const assessment = { id: refId!, ...payload } as CcValidationAssessment;
  await syncChangeControlImpact(change, assessment);
  if (input.csv_assessment_completed && !existing?.csv_assessment_completed) {
    await audit(actor, 'CSV review completed', change.id, 'CSV assessment section completed', refId);
    await mirrorCsvAssessment(change, assessment);
  } else if (input.csv_assessment_completed) {
    await mirrorCsvAssessment(change, assessment);
  }
  if (input.annex_11_review_completed && !existing?.annex_11_review_completed) {
    await audit(actor, 'Annex 11 review completed', change.id, 'Annex 11 review completed', refId);
  }
  if (input.validation_deliverables?.length && JSON.stringify(input.validation_deliverables) !== JSON.stringify(existing?.validation_deliverables || [])) {
    await audit(actor, 'deliverables selected', change.id, input.validation_deliverables.join(', '), refId);
  }
  return { assessment };
}

export async function submitCcValidationForQaReview(
  input: CcValidationFormInput,
  actor: CcValidationActor,
): Promise<{ assessment?: CcValidationAssessment; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase not configured' };
  const change = await getChangeById(input.change_id);
  if (!change) return { error: 'Change control not found' };

  const ruleCheck = validateCcValidationRules(input, change);
  if (!ruleCheck.ok) {
    return { error: ruleCheck.errors.join(' ') };
  }

  const draft = await saveCcValidationDraft(input, actor);
  if (draft.error || !draft.assessment) return draft;

  const updates = {
    status: 'QA Review',
    progress_percent: 70,
    head_qa_review_pending: false,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.validation, draft.assessment.id), updates);
  await audit(actor, 'validation impact updated', input.change_id, 'Submitted for QA review', draft.assessment.id);
  const assessment = { ...draft.assessment, ...updates } as CcValidationAssessment;
  await runSubmitNotifications(change, assessment);
  return { assessment };
}

export async function submitCcValidationQaReview(
  changeId: string,
  input: CcValidationQaReviewInput,
  actor: CcValidationActor,
): Promise<{ assessment?: CcValidationAssessment; error?: string }> {
  const [change, existing] = await Promise.all([getChangeById(changeId), getCcValidationAssessment(changeId)]);
  if (!change || !existing) return { error: 'Assessment not found' };
  if (existing.head_qa_review_pending) {
    return { error: 'Head QA approval required for this record' };
  }
  if (!canApproveCcValidation(actor.role, existing.validation_category)) {
    return { error: 'QA approval permission required' };
  }
  const approved = input.decision === 'approved';
  const headQaRequired = approved && requiresHeadQaValidationApproval(change, existing);
  const status = !approved ? 'Rejected' : headQaRequired ? 'QA Review' : 'Approved';
  const updates: Partial<CcValidationAssessment> = {
    qa_comments: input.qa_comments,
    head_qa_comments: input.head_qa_comments || existing.head_qa_comments,
    status,
    head_qa_review_pending: headQaRequired,
    progress_percent: approved ? (headQaRequired ? 80 : 95) : 25,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.validation, existing.id), updates);
  if (status === 'Approved') {
    await audit(actor, 'assessment approved', changeId, input.qa_comments, existing.id);
    await syncChangeControlImpact(change, { ...existing, ...updates });
  } else if (headQaRequired) {
    await audit(actor, 'QA review completed', changeId, 'Forwarded to Head QA', existing.id);
    await notify('Head QA Validation Review', `Critical validation for ${change.change_control_number} requires Head QA approval.`, changeId, { targetRole: 'head_qa' });
  } else {
    await audit(actor, 'assessment rejected', changeId, input.qa_comments, existing.id);
  }
  return { assessment: { ...existing, ...updates } };
}

export async function submitCcValidationHeadQaReview(
  changeId: string,
  input: CcValidationQaReviewInput,
  actor: CcValidationActor,
): Promise<{ assessment?: CcValidationAssessment; error?: string }> {
  const [change, existing] = await Promise.all([getChangeById(changeId), getCcValidationAssessment(changeId)]);
  if (!change || !existing) return { error: 'Assessment not found' };
  if (!['super_admin', 'head_qa'].includes(normalizeRole(actor.role || ''))) {
    return { error: 'Head QA approval required' };
  }
  if (!existing.head_qa_review_pending) {
    return { error: 'QA review must be completed before Head QA approval' };
  }
  const approved = input.decision === 'approved';
  const status = approved ? 'Approved' : 'Rejected';
  const updates: Partial<CcValidationAssessment> = {
    head_qa_comments: input.head_qa_comments || input.qa_comments,
    status,
    head_qa_review_pending: false,
    progress_percent: approved ? 95 : 25,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.validation, existing.id), updates);
  if (approved) {
    await audit(actor, 'QA review completed', changeId, 'Head QA approved', existing.id);
    await audit(actor, 'assessment approved', changeId, 'Head QA approved', existing.id);
    await syncChangeControlImpact(change, { ...existing, ...updates });
  } else {
    await audit(actor, 'assessment rejected', changeId, updates.head_qa_comments, existing.id);
  }
  return { assessment: { ...existing, ...updates } };
}

export async function softDeleteCcValidationAssessment(changeId: string, actor: CcValidationActor) {
  const existing = await getCcValidationAssessment(changeId);
  if (!existing) return { error: 'Assessment not found' };
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.validation, existing.id), {
    is_deleted: true, updated_at: nowIso(), updated_by: actor.id,
  });
  await audit(actor, 'assessment deleted', changeId, 'Soft deleted', existing.id);
  return { ok: true };
}

export {
  computeCcValidationDashboardMetrics,
  computeCcValidationChartData,
};

export type { CcValidationDashboardMetrics, CcValidationChartData };

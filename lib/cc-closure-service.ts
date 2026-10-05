import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { normalizeRole } from '@/lib/permissions';
import {
  CC_CLOSURE_MODULE,
  computeCcClosureDashboardMetrics,
  computeCcClosureDecision,
  computeCcClosureReadiness,
  type CcClosureActor,
  type CcClosureFormInput,
} from '@/lib/cc-closure-records';
import {
  CC_COLLECTIONS,
  requiresHeadQaApproval,
  type ChangeClosure,
  type ChangeControlRecord,
} from '@/lib/change-control-types';
import {
  getApprovals,
  getAttachments,
  getAuditLogsForChange,
  getChangeById,
  getEffectivenessReview,
  getImpactAssessment,
  getImplementationActions,
  getRiskAssessment,
  listChanges,
  updateChange,
} from '@/lib/change-control-service';

export type { CcClosureActor, CcClosureFormInput };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

function buildClosureId(changeNumber: string) {
  return `CCCL-${changeNumber.replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
}

async function audit(actor: CcClosureActor, actionType: string, changeId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: CC_CLOSURE_MODULE,
      collectionName: CC_COLLECTIONS.closure,
      recordId: changeId,
      documentNumber: detail?.split('—')[0]?.trim(),
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('cc closure audit', e);
  }
}

async function notify(title: string, message: string, changeId: string, userId?: string, targetRole?: string) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.notifications), {
      title, message, module: CC_CLOSURE_MODULE, record_id: changeId,
      ...(userId ? { user_id: userId } : {}),
      ...(targetRole ? { target_role: targetRole } : {}),
      read: false, created_at: nowIso(),
    });
  } catch (e) {
    console.error('cc closure notify', e);
  }
}

async function saveEsignMetadata(
  change: ChangeControlRecord,
  esignId: string,
  actor: CcClosureActor,
  actionType: string,
) {
  if (!isFirebaseConfigured() || !esignId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), 'esign_records'), {
      esign_record_id: esignId,
      module_name: CC_CLOSURE_MODULE,
      record_id: change.id,
      document_number: change.change_control_number,
      action_type: actionType,
      user_id: actor.id,
      user_name: actor.name,
      user_email: actor.email || '',
      signed_date_time: nowIso(),
      authentication_status: 'Success',
      is_deleted: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('cc closure esign', e);
  }
}

async function fetchOptionalCollection(changeId: string, collectionName: string): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), collectionName),
      where('change_id', '==', changeId),
      limit(1),
    ));
    return !snap.empty;
  } catch {
    return false;
  }
}

async function loadClosureContext(changeId: string) {
  const change = await getChangeById(changeId);
  if (!change) return null;
  const [impact, risk, implementation, effectiveness, approvals, attachments] = await Promise.all([
    getImpactAssessment(changeId),
    getRiskAssessment(changeId),
    getImplementationActions(changeId),
    getEffectivenessReview(changeId),
    getApprovals(changeId),
    getAttachments(changeId),
  ]);
  const [validationAssessmentExists, documentRevisionExists, trainingRecordExists] = await Promise.all([
    fetchOptionalCollection(changeId, CC_COLLECTIONS.validation),
    fetchOptionalCollection(changeId, 'document_revisions'),
    fetchOptionalCollection(changeId, 'training_records'),
  ]);
  return {
    change, impact, risk, implementation, effectiveness, approvals, attachments,
    validationAssessmentExists, documentRevisionExists, trainingRecordExists,
  };
}

function buildClosurePayload(
  change: ChangeControlRecord,
  form: CcClosureFormInput,
  actor: CcClosureActor,
  readinessPercent: number,
  status: string,
  existing?: ChangeClosure | null,
): Omit<ChangeClosure, 'id'> {
  const ts = nowIso();
  return {
    closure_id: existing?.closure_id || buildClosureId(change.change_control_number),
    change_control_id: change.id,
    change_control_number: change.change_control_number,
    closure_date: status === 'Closed' ? today() : null,
    closed_by: status === 'Closed' ? actor.id : existing?.closed_by || '',
    closed_by_name: status === 'Closed' ? actor.name : existing?.closed_by_name || '',
    department: change.department,
    impact_assessment_completed: form.impact_assessment_completed,
    risk_assessment_completed: form.risk_assessment_completed,
    validation_assessment_completed: form.validation_assessment_completed,
    implementation_completed: form.implementation_completed,
    training_completed: form.training_completed,
    document_revision_completed: form.document_revision_completed,
    validation_completed: form.validation_completed,
    csv_completed: form.csv_completed,
    regulatory_action_completed: form.regulatory_action_completed,
    effectiveness_review_completed: form.effectiveness_review_completed,
    effectiveness_result: form.effectiveness_result,
    capa_required: form.capa_required,
    capa_linked: form.capa_linked,
    capa_completed: form.capa_completed,
    all_evidence_reviewed: form.all_evidence_reviewed,
    qa_closure_comments: form.qa_closure_comments,
    head_qa_comments: form.head_qa_comments || '',
    final_closure_conclusion: form.final_closure_conclusion,
    closure_status: status,
    readiness_percent: readinessPercent,
    e_signature_required: true,
    e_signature: existing?.e_signature || '',
    e_signature_status: existing?.e_signature_status || 'Not Signed',
    signed_by: existing?.signed_by || '',
    signed_date: existing?.signed_date || null,
    created_at: existing?.created_at || ts,
    updated_at: ts,
    created_by: existing?.created_by || actor.id,
    created_by_name: existing?.created_by_name || actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    is_deleted: false,
  };
}

function defaultFormFromContext(
  ctx: NonNullable<Awaited<ReturnType<typeof loadClosureContext>>>,
  closure?: ChangeClosure | null,
): CcClosureFormInput {
  const { change, impact, risk, implementation, effectiveness, attachments } = ctx;
  const implDone = implementation.length > 0 && implementation.every((a) => a.status === 'completed');
  const documentRequired = Boolean(change.affected_documents?.trim()) || change.change_type === 'Document Change';
  return {
    impact_assessment_completed: closure?.impact_assessment_completed ?? Boolean(impact?.assessed_at),
    risk_assessment_completed: closure?.risk_assessment_completed ?? Boolean(risk?.assessed_at),
    validation_assessment_completed: closure?.validation_assessment_completed ?? ctx.validationAssessmentExists,
    implementation_completed: closure?.implementation_completed ?? implDone,
    training_completed: closure?.training_completed ?? (ctx.trainingRecordExists || !change.training_impact),
    document_revision_completed: closure?.document_revision_completed ?? (ctx.documentRevisionExists || !documentRequired),
    validation_completed: closure?.validation_completed ?? implementation.filter((a) => a.action_type === 'validation').every((a) => a.status === 'completed'),
    csv_completed: closure?.csv_completed ?? (!change.csv_impact || implementation.filter((a) => a.action_type === 'csv').every((a) => a.status === 'completed')),
    regulatory_action_completed: closure?.regulatory_action_completed ?? (!change.regulatory_impact),
    effectiveness_review_completed: closure?.effectiveness_review_completed ?? Boolean(effectiveness?.review_date),
    effectiveness_result: closure?.effectiveness_result || effectiveness?.result || (change.effectiveness_check_required ? 'Pending' : 'N/A'),
    capa_required: closure?.capa_required ?? change.capa_required,
    capa_linked: closure?.capa_linked ?? Boolean(change.linked_capa_id),
    capa_completed: closure?.capa_completed ?? (!change.capa_required || Boolean(change.linked_capa_id)),
    all_evidence_reviewed: closure?.all_evidence_reviewed ?? (attachments.length > 0 || implementation.some((a) => a.evidence)),
    qa_closure_comments: closure?.qa_closure_comments || '',
    head_qa_comments: closure?.head_qa_comments || '',
    final_closure_conclusion: closure?.final_closure_conclusion || '',
  };
}

export async function getCcClosure(changeId: string): Promise<ChangeClosure | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CC_COLLECTIONS.closure),
      where('change_control_id', '==', changeId),
      where('is_deleted', '==', false),
      orderBy('updated_at', 'desc'),
      limit(1),
    ));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as ChangeClosure;
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CC_COLLECTIONS.closure),
      where('change_control_id', '==', changeId),
      limit(1),
    ));
    if (snap.empty) return null;
    const d = snap.docs[0].data();
    if (d.is_deleted) return null;
    return { id: snap.docs[0].id, ...d } as ChangeClosure;
  }
}

export async function listCcClosures(max = 200): Promise<(ChangeClosure & { change?: ChangeControlRecord | null })[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CC_COLLECTIONS.closure),
      where('is_deleted', '==', false),
      orderBy('updated_at', 'desc'),
      limit(max),
    ));
    const closures = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChangeClosure));
    return Promise.all(closures.map(async (c) => ({ ...c, change: await getChangeById(c.change_control_id) })));
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), CC_COLLECTIONS.closure));
    const closures = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChangeClosure)).filter((c) => !c.is_deleted);
    return Promise.all(closures.map(async (c) => ({ ...c, change: await getChangeById(c.change_control_id) })));
  }
}

export async function fetchCcClosurePageData(changeId: string) {
  if (!changeId) return { error: 'Change Control ID is required.' };
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const ctx = await loadClosureContext(changeId);
    if (!ctx) return { error: 'Change control record not found.' };

    const closure = await getCcClosure(changeId);
    const auditLogs = await getAuditLogsForChange(changeId);
    const formDefaults = defaultFormFromContext(ctx, closure);

    const readiness = computeCcClosureReadiness({
      change: ctx.change,
      impact: ctx.impact,
      risk: ctx.risk,
      implementation: ctx.implementation,
      effectiveness: ctx.effectiveness,
      approvals: ctx.approvals,
      attachmentCount: ctx.attachments.length,
      validationAssessmentExists: ctx.validationAssessmentExists,
      documentRevisionExists: ctx.documentRevisionExists,
      trainingRecordExists: ctx.trainingRecordExists,
      form: formDefaults,
    });

    return {
      change: ctx.change,
      closure,
      impact: ctx.impact,
      risk: ctx.risk,
      implementation: ctx.implementation,
      effectiveness: ctx.effectiveness,
      approvals: ctx.approvals,
      attachments: ctx.attachments,
      readiness,
      formDefaults,
      auditLogs,
      headQaRequired: requiresHeadQaApproval(ctx.change.change_category),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load closure data' };
  }
}

export async function fetchCcClosureDashboard() {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured', closures: [], changes: [], metrics: computeCcClosureDashboardMetrics([], []) };
  const [closures, changes] = await Promise.all([listCcClosures(), listChanges()]);
  return {
    closures,
    changes,
    metrics: computeCcClosureDashboardMetrics(closures, changes),
  };
}

export async function saveCcClosureDraft(
  changeId: string,
  form: CcClosureFormInput,
  actor: CcClosureActor,
): Promise<ChangeClosure> {
  const ctx = await loadClosureContext(changeId);
  if (!ctx) throw new Error('Change control not found');

  const readiness = computeCcClosureReadiness({
    change: ctx.change,
    impact: ctx.impact,
    risk: ctx.risk,
    implementation: ctx.implementation,
    effectiveness: ctx.effectiveness,
    approvals: ctx.approvals,
    attachmentCount: ctx.attachments.length,
    validationAssessmentExists: ctx.validationAssessmentExists,
    documentRevisionExists: ctx.documentRevisionExists,
    trainingRecordExists: ctx.trainingRecordExists,
    form,
  });

  const decision = computeCcClosureDecision(form);
  const existing = await getCcClosure(changeId);
  const status = existing?.closure_status === 'Closed' ? 'Closed' : (readiness.ready ? decision.status : 'Pending');
  const payload = buildClosurePayload(ctx.change, form, actor, readiness.percent, status, existing);

  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.closure, existing.id), payload);
    await audit(actor, 'closure checklist generated', changeId, 'Checklist updated');
    return { id: existing.id, ...payload };
  }

  const ref = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.closure), payload);
  await audit(actor, 'closure readiness checked', changeId, payload.closure_id);
  await notify('Closure Initiated', `Closure checklist started for ${ctx.change.change_control_number}`, changeId, ctx.change.initiated_by);
  return { id: ref.id, ...payload };
}

export async function submitCcClosureForQaReview(
  changeId: string,
  form: CcClosureFormInput,
  actor: CcClosureActor,
): Promise<ChangeClosure> {
  const ctx = await loadClosureContext(changeId);
  if (!ctx) throw new Error('Change control not found');

  const readiness = computeCcClosureReadiness({
    change: ctx.change,
    impact: ctx.impact,
    risk: ctx.risk,
    implementation: ctx.implementation,
    effectiveness: ctx.effectiveness,
    approvals: ctx.approvals,
    attachmentCount: ctx.attachments.length,
    validationAssessmentExists: ctx.validationAssessmentExists,
    documentRevisionExists: ctx.documentRevisionExists,
    trainingRecordExists: ctx.trainingRecordExists,
    form,
  });

  if (!readiness.ready) throw new Error(`Closure blocked: ${readiness.blockers.join('; ')}`);
  if (form.effectiveness_result === 'Not Effective') throw new Error('Cannot close when effectiveness result is Not Effective');
  if (!form.qa_closure_comments.trim()) throw new Error('QA closure comments are required');
  if (!form.final_closure_conclusion.trim()) throw new Error('Final closure conclusion is required');
  if (ctx.change.effectiveness_check_required && !form.effectiveness_result.trim()) {
    throw new Error('Effectiveness result is required');
  }

  const headQaRequired = requiresHeadQaApproval(ctx.change.change_category);
  const status = headQaRequired ? 'Head QA Review' : 'QA Review';
  const existing = await getCcClosure(changeId);
  const payload = buildClosurePayload(ctx.change, form, actor, readiness.percent, status, existing);

  let saved: ChangeClosure;
  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.closure, existing.id), payload);
    saved = { id: existing.id, ...payload };
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.closure), payload);
    saved = { id: ref.id, ...payload };
  }

  await audit(actor, 'implementation reviewed', changeId, form.qa_closure_comments);
  await audit(actor, 'validation reviewed', changeId, 'Submitted for closure QA review');
  await audit(actor, 'effectiveness reviewed', changeId, form.effectiveness_result);
  await notify('Change Closure QA Review', `${ctx.change.change_control_number} submitted for closure review`, changeId, undefined, 'head_qa');
  return saved;
}

export async function approveCcClosure(
  changeId: string,
  form: CcClosureFormInput,
  eSignature: string,
  actor: CcClosureActor,
): Promise<ChangeClosure> {
  const ctx = await loadClosureContext(changeId);
  if (!ctx) throw new Error('Change control not found');
  const existing = await getCcClosure(changeId);
  if (!existing) throw new Error('Closure record not found — save draft first');

  if (requiresHeadQaApproval(ctx.change.change_category) && !['head_qa', 'super_admin'].includes(normalizeRole(actor.role || ''))) {
    throw new Error('Head QA approval required for critical change closure');
  }
  if (!eSignature.trim()) throw new Error('E-signature required for closure');
  if (!form.qa_closure_comments.trim()) throw new Error('QA closure comments are required');
  if (!form.final_closure_conclusion.trim()) throw new Error('Final closure conclusion is required');

  const readiness = computeCcClosureReadiness({
    change: ctx.change,
    impact: ctx.impact,
    risk: ctx.risk,
    implementation: ctx.implementation,
    effectiveness: ctx.effectiveness,
    approvals: ctx.approvals,
    attachmentCount: ctx.attachments.length,
    validationAssessmentExists: ctx.validationAssessmentExists,
    documentRevisionExists: ctx.documentRevisionExists,
    trainingRecordExists: ctx.trainingRecordExists,
    form,
  });
  if (!readiness.ready) throw new Error(`Closure blocked: ${readiness.blockers.join('; ')}`);
  if (form.effectiveness_result === 'Not Effective') throw new Error('Cannot close when effectiveness result is Not Effective');

  const ts = nowIso();
  const payload = {
    ...buildClosurePayload(ctx.change, form, actor, readiness.percent, 'Closed', existing),
    closure_date: today(),
    closed_by: actor.id,
    closed_by_name: actor.name,
    e_signature: eSignature,
    e_signature_status: 'Signed',
    signed_by: actor.name,
    signed_date: ts,
    updated_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };

  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.closure, existing.id), payload);
  await saveEsignMetadata(ctx.change, eSignature, actor, 'Change Closed');

  await updateChange(changeId, {
    status: 'closed',
    qa_remarks: form.qa_closure_comments || ctx.change.qa_remarks,
    actual_implementation_date: ctx.change.actual_implementation_date || today(),
  }, { id: actor.id, name: actor.name, role: actor.role || '' }, true);

  await audit(actor, 'change closed', changeId, form.final_closure_conclusion);
  await audit(actor, 'e-signature success', changeId, eSignature);
  await notify('Change Control Closed', `${ctx.change.change_control_number} has been closed`, changeId, ctx.change.initiated_by);
  await notify('Change Control Closed', ctx.change.change_control_number, changeId, undefined, 'head_qa');

  return { id: existing.id, ...payload };
}

export async function reopenCcClosure(
  changeId: string,
  reason: string,
  eSignature: string,
  actor: CcClosureActor,
): Promise<ChangeClosure> {
  const ctx = await loadClosureContext(changeId);
  if (!ctx) throw new Error('Change control not found');
  if (!['head_qa', 'super_admin'].includes(normalizeRole(actor.role || ''))) {
    throw new Error('Only Head QA or Super Admin can reopen');
  }
  if (!reason.trim()) throw new Error('Reopen reason is required');
  if (!eSignature.trim()) throw new Error('E-signature required for reopen');

  const existing = await getCcClosure(changeId);
  const ts = nowIso();
  const payload: Partial<ChangeClosure> = {
    closure_status: 'Reopened',
    closure_date: null,
    e_signature: eSignature,
    e_signature_status: 'Signed',
    signed_by: actor.name,
    signed_date: ts,
    updated_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };

  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.closure, existing.id), payload);
  }

  await updateChange(changeId, { status: 'implementation_in_progress' }, { id: actor.id, name: actor.name, role: actor.role || '' }, true, { reopen: true });
  await saveEsignMetadata(ctx.change, eSignature, actor, 'Change Reopened');
  await audit(actor, 'change reopened', changeId, reason);
  await audit(actor, 'e-signature success', changeId, eSignature);
  await notify('Change Control Reopened', `${ctx.change.change_control_number}: ${reason}`, changeId, ctx.change.initiated_by);

  return { ...(existing || {} as ChangeClosure), ...payload } as ChangeClosure;
}

export async function logCcClosureSectionReviewed(
  actor: CcClosureActor,
  changeId: string,
  section: 'implementation' | 'validation' | 'training' | 'document' | 'effectiveness',
) {
  const actionMap = {
    implementation: 'implementation reviewed',
    validation: 'validation reviewed',
    training: 'training reviewed',
    document: 'document revision reviewed',
    effectiveness: 'effectiveness reviewed',
  } as const;
  await audit(actor, actionMap[section], changeId, `${section} summary viewed`);
}

export async function logCcClosureEsignResult(
  actor: CcClosureActor,
  changeId: string,
  success: boolean,
  detail?: string,
) {
  await audit(actor, success ? 'e-signature success' : 'e-signature failed', changeId, detail);
}

export async function rejectCcClosure(
  changeId: string,
  reason: string,
  actor: CcClosureActor,
): Promise<ChangeClosure> {
  const existing = await getCcClosure(changeId);
  if (!existing?.id) throw new Error('Closure record not found');
  const payload = { closure_status: 'Rejected', updated_at: nowIso(), updated_by: actor.id, updated_by_name: actor.name };
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.closure, existing.id), payload);
  await audit(actor, 'closure rejected', changeId, reason);
  return { ...existing, ...payload };
}

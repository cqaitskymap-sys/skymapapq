import {
  collection, doc, addDoc, getDocs, updateDoc, query, where, limit, orderBy,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  computeInvestigationAutoRules,
  type InvestigationActor,
  type InvestigationFormInput,
  type InvestigationQaReviewInput,
} from '@/lib/deviation-investigation-records';
import {
  DEVIATION_COLLECTIONS,
  type DeviationInvestigation,
  type DeviationRecord,
} from '@/lib/deviation-types';
import {
  applyOverdueCheck,
  createCapaFromDeviation,
  getAttachments,
  getAuditLogsForDeviation,
  getDeviationById,
  getImpactAssessment,
  linkCapa,
  updateDeviation,
  uploadAttachment,
} from '@/lib/deviation-service';

export type { InvestigationActor, InvestigationFormInput, InvestigationQaReviewInput };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

async function audit(
  actor: InvestigationActor,
  actionType: string,
  deviationId: string,
  detail?: string,
) {
  try {
    await createAuditLog({
      moduleName: 'Deviation Investigation',
      collectionName: DEVIATION_COLLECTIONS.investigations,
      recordId: deviationId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
  } catch (e) {
    console.error('investigation audit', e);
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
    console.error('investigation notify', e);
  }
}

export async function getInvestigationRecord(deviationId: string): Promise<DeviationInvestigation | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations),
      where('deviation_id', '==', deviationId),
      where('is_deleted', '==', false),
      limit(1),
    ));
    if (snap.empty) {
      const fallback = await getDocs(query(
        collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations),
        where('deviation_id', '==', deviationId),
        limit(1),
      ));
      if (fallback.empty) return null;
      return { id: fallback.docs[0].id, ...fallback.docs[0].data() } as DeviationInvestigation;
    }
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as DeviationInvestigation;
  } catch (e) {
    console.error('getInvestigationRecord', e);
    return null;
  }
}

export async function listOpenInvestigations(max = 100): Promise<(DeviationRecord & { investigation?: DeviationInvestigation | null })[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations),
      orderBy('updated_at', 'desc'),
      limit(max),
    ));
    const records = snap.docs
      .map((d) => applyOverdueCheck({ id: d.id, ...d.data() } as DeviationRecord))
      .filter((r) => !r.is_deleted && ['submitted', 'under_investigation', 'qa_review', 'capa_required', 'overdue'].includes(r.status));

    const withInv = await Promise.all(records.map(async (r) => ({
      ...r,
      investigation: await getInvestigationRecord(r.id),
    })));
    return withInv;
  } catch (e) {
    console.error('listOpenInvestigations', e);
    return [];
  }
}

export async function fetchInvestigationPageData(deviationId: string) {
  if (!isFirebaseConfigured()) {
    return { error: 'Firebase is not configured.' };
  }
  try {
    const [record, investigation, impact, attachments, auditLogs] = await Promise.all([
      getDeviationById(deviationId),
      getInvestigationRecord(deviationId),
      getImpactAssessment(deviationId),
      getAttachments(deviationId),
      getAuditLogsForDeviation(deviationId),
    ]);
    if (!record) return { error: 'Deviation not found.' };
    return { record: applyOverdueCheck(record), investigation, impact, attachments, auditLogs };
  } catch (e) {
    console.error('fetchInvestigationPageData', e);
    return { error: e instanceof Error ? e.message : 'Failed to load investigation data' };
  }
}

function buildInvestigationPayload(
  deviationId: string,
  record: DeviationRecord,
  input: InvestigationFormInput,
  actor: InvestigationActor,
  status: string,
  existing?: DeviationInvestigation | null,
): Omit<DeviationInvestigation, 'id'> {
  const ts = nowIso();
  const auto = computeInvestigationAutoRules(input, record);
  return {
    deviation_id: deviationId,
    deviation_number: record.deviation_number,
    investigation_start_date: existing?.investigation_start_date || existing?.started_at?.slice(0, 10) || today(),
    investigation_due_date: input.investigation_due_date || record.target_closure_date || undefined,
    rca_method: input.rca_method,
    root_cause_details: input.root_cause_details,
    root_cause: input.root_cause || input.root_cause_details,
    contributing_factors: input.contributing_factors || '',
    investigation_summary: input.investigation_summary,
    detailed_investigation: input.detailed_investigation || '',
    immediate_correction: input.immediate_correction || record.immediate_action,
    corrective_action_required: input.corrective_action_required ?? false,
    preventive_action_required: input.preventive_action_required ?? false,
    capa_required: input.capa_required ?? auto.capaRequired,
    linked_capa_number: record.linked_capa_number,
    impact_on_batch: input.impact_on_batch || record.batch_impact || (record.batch_impacted ? 'Yes' : 'No'),
    impact_on_product_quality: input.impact_on_product_quality || record.product_quality_impact || (record.product_quality_impacted ? 'Yes' : 'No'),
    impact_on_patient_safety: input.impact_on_patient_safety || record.patient_safety_impact || (record.patient_safety_impacted ? 'Yes' : 'No'),
    impact_on_regulatory_compliance: input.impact_on_regulatory_compliance || record.regulatory_impact_status || (record.regulatory_impact ? 'Yes' : 'No'),
    other_batches_impacted: input.other_batches_impacted || 'No',
    other_batches_details: input.other_batches_details || '',
    final_investigation_conclusion: input.final_investigation_conclusion || '',
    investigation_status: status,
    investigator_id: existing?.investigator_id || record.assigned_investigator || actor.id,
    investigator_name: existing?.investigator_name || record.assigned_investigator_name || actor.name,
    department: record.department,
    five_why: input.five_why,
    started_at: existing?.started_at || ts,
    completed_at: existing?.completed_at || null,
    created_at: existing?.created_at || ts,
    updated_at: ts,
    created_by: existing?.created_by || actor.id,
    updated_by: actor.id,
    created_by_name: existing?.created_by_name || actor.name,
    updated_by_name: actor.name,
    is_deleted: false,
  };
}

export async function startInvestigation(
  deviationId: string,
  actor: InvestigationActor,
): Promise<{ investigation?: DeviationInvestigation; error?: string }> {
  const record = await getDeviationById(deviationId);
  if (!record) return { error: 'Deviation not found' };

  const payload = buildInvestigationPayload(deviationId, record, {
    investigation_summary: 'Investigation initiated',
    rca_method: '5 Why',
    root_cause_details: '',
    investigation_due_date: record.target_closure_date || undefined,
  }, actor, 'In Progress');

  try {
    const existing = await getInvestigationRecord(deviationId);
    let result: DeviationInvestigation;
    if (existing) {
      await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations, existing.id), payload);
      result = { ...existing, ...payload, id: existing.id };
    } else {
      const ref = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations), payload);
      result = { id: ref.id, ...payload };
    }
    await updateDeviation(deviationId, { status: 'under_investigation' }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, { workflow: true });
    await audit(actor, 'Investigation Started', deviationId, record.deviation_number);
    await notify('Investigation Started', `${record.deviation_number} investigation started`, deviationId, actor.id);
    return { investigation: result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to start investigation' };
  }
}

export async function saveInvestigationDraft(
  deviationId: string,
  input: InvestigationFormInput,
  actor: InvestigationActor,
): Promise<{ investigation?: DeviationInvestigation; error?: string }> {
  const record = await getDeviationById(deviationId);
  if (!record) return { error: 'Deviation not found' };

  const auto = computeInvestigationAutoRules(input, record);
  if (auto.warnings.some((w) => w.includes('batch impact details'))) {
    return { error: 'Other batches impacted — batch impact details are required.' };
  }

  const status = input.capa_required || auto.capaRequired ? 'CAPA Required' : 'In Progress';
  const payload = buildInvestigationPayload(deviationId, record, { ...input, capa_required: input.capa_required ?? auto.capaRequired }, actor, status);

  try {
    const existing = await getInvestigationRecord(deviationId);
    let result: DeviationInvestigation;
    if (existing) {
      await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations, existing.id), payload);
      result = { ...existing, ...payload, id: existing.id };
      await audit(actor, 'Investigation Edited', deviationId);
    } else {
      const ref = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations), payload);
      result = { id: ref.id, ...payload };
      await audit(actor, 'Investigation Draft Created', deviationId);
    }

    await updateDeviation(deviationId, {
      root_cause: payload.root_cause || payload.root_cause_details,
      capa_required: payload.capa_required,
      status: 'under_investigation',
    }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, { workflow: true });

    if (payload.rca_method) await audit(actor, 'RCA Updated', deviationId, payload.rca_method);
    if (input.impact_on_product_quality || input.impact_on_patient_safety) {
      await audit(actor, 'Impact Assessment Updated', deviationId);
    }

    return { investigation: result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save investigation' };
  }
}

export async function submitInvestigationForQaReview(
  deviationId: string,
  input: InvestigationFormInput,
  actor: InvestigationActor,
): Promise<{ investigation?: DeviationInvestigation; error?: string }> {
  if (!input.investigation_summary?.trim()) return { error: 'Investigation summary is required' };
  if (!input.root_cause_details?.trim() && !input.root_cause?.trim()) {
    return { error: 'Root cause is required before submitting for QA review' };
  }
  if (!input.final_investigation_conclusion?.trim()) {
    return { error: 'Final investigation conclusion is required before submitting for QA review' };
  }

  const draft = await saveInvestigationDraft(deviationId, input, actor);
  if (draft.error || !draft.investigation) return draft;

  try {
    const payload = {
      investigation_status: 'QA Review',
      updated_at: nowIso(),
      updated_by: actor.id,
      updated_by_name: actor.name,
    };
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations, draft.investigation.id), payload);
    await updateDeviation(deviationId, { status: 'qa_review' }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, { workflow: true });
    await audit(actor, 'Investigation Submitted for QA Review', deviationId);
    await notify('Investigation QA Review', `${draft.investigation.deviation_number} submitted for QA review`, deviationId, 'qa_manager');
    return { investigation: { ...draft.investigation, ...payload } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Submit failed' };
  }
}

export async function reviewInvestigation(
  deviationId: string,
  input: InvestigationQaReviewInput,
  actor: InvestigationActor,
  record: DeviationRecord,
): Promise<{ investigation?: DeviationInvestigation; error?: string }> {
  if (input.decision === 'rejected' && !input.qa_comments.trim()) {
    return { error: 'QA comments are required for rejection' };
  }

  const inv = await getInvestigationRecord(deviationId);
  if (!inv) return { error: 'Investigation record not found' };

  const status = input.decision === 'approved'
    ? (inv.capa_required || record.capa_required ? 'CAPA Required' : 'Completed')
    : 'Rejected';

  try {
    const payload = {
      investigation_status: status,
      reviewed_by_qa: actor.id,
      reviewed_by_qa_name: actor.name,
      qa_review_date: nowIso(),
      qa_comments: input.qa_comments,
      completed_at: input.decision === 'approved' ? nowIso() : null,
      updated_at: nowIso(),
      updated_by: actor.id,
      updated_by_name: actor.name,
    };
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations, inv.id), payload);

    const devStatus = input.decision === 'approved'
      ? (inv.capa_required || record.capa_required ? 'capa_required' : 'approved')
      : 'rejected';
    await updateDeviation(deviationId, { status: devStatus }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, { workflow: true });

    await audit(actor, input.decision === 'approved' ? 'Investigation QA Approved' : 'Investigation QA Rejected', deviationId, input.qa_comments);

    if (inv.impact_on_patient_safety === 'Yes' || record.patient_safety_impacted) {
      await notify('Patient Safety Investigation Reviewed', record.deviation_number, deviationId, 'head_qa');
    }

    return { investigation: { ...inv, ...payload } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'QA review failed' };
  }
}

export async function closeInvestigation(
  deviationId: string,
  actor: InvestigationActor,
): Promise<{ error?: string }> {
  const inv = await getInvestigationRecord(deviationId);
  if (!inv) return { error: 'Investigation not found' };
  if (!inv.root_cause_details?.trim() && !inv.root_cause?.trim()) {
    return { error: 'Root cause is required before closure' };
  }
  if (!inv.final_investigation_conclusion?.trim()) {
    return { error: 'Final conclusion is required before closure' };
  }

  try {
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations, inv.id), {
      investigation_status: 'Closed',
      completed_at: nowIso(),
      updated_at: nowIso(),
      updated_by: actor.id,
      updated_by_name: actor.name,
    });
    await audit(actor, 'Investigation Closed', deviationId);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Closure failed' };
  }
}

export async function syncInvestigationOverdue(deviationId: string): Promise<void> {
  const record = await getDeviationById(deviationId);
  const inv = await getInvestigationRecord(deviationId);
  if (!record || !inv) return;
  const due = inv.investigation_due_date || record.target_closure_date;
  if (!due || due >= today()) return;
  if (['Completed', 'Closed', 'Rejected'].includes(inv.investigation_status || '')) return;
  try {
    await updateDeviation(deviationId, { status: 'overdue' }, { id: 'system', name: 'System', role: 'admin' }, { workflow: true });
  } catch (e) {
    console.error('syncInvestigationOverdue', e);
  }
}

export {
  createCapaFromDeviation,
  linkCapa,
  uploadAttachment,
  getAttachments,
  getAuditLogsForDeviation,
};

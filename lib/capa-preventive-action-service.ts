import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  applyPreventiveActionOverdueCheck,
  buildPreventiveActionNumber,
  canApproveCriticalCapaPreventiveAction,
  CAPA_PREVENTIVE_ACTION_MODULE,
  computePreventiveActionDashboardMetrics,
  hasRequiredPreventiveEvidence,
  validatePreventiveActionClosureRequirements,
  type CapaPreventiveActionActor,
  type CapaPreventiveActionFormInput,
  type CapaPreventiveActionImplementationInput,
  type CapaPreventiveActionLinkInput,
  type CapaPreventiveActionVerificationInput,
} from '@/lib/capa-preventive-action-records';
import { getCapaInvestigationByCapaId } from '@/lib/capa-investigation-service';
import { isInvestigationApproved } from '@/lib/capa-investigation-records';
import { getCapaById } from '@/lib/capa-service';
import {
  CAPA_COLLECTIONS,
  type CapaPreventiveAction,
  type CapaPreventiveActionDashboardMetrics,
  type CapaRecord,
} from '@/lib/capa-types';

export type {
  CapaPreventiveActionActor,
  CapaPreventiveActionFormInput,
  CapaPreventiveActionImplementationInput,
  CapaPreventiveActionLinkInput,
  CapaPreventiveActionVerificationInput,
};

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

async function audit(
  actor: CapaPreventiveActionActor,
  actionType: string,
  capaId: string,
  detail?: string,
  recordId?: string,
) {
  try {
    await createAuditLog({
      moduleName: CAPA_PREVENTIVE_ACTION_MODULE,
      collectionName: CAPA_COLLECTIONS.preventiveActions,
      recordId: recordId || capaId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('capa preventive action audit', e);
  }
}

async function notify(title: string, message: string, capaId: string, userId: string) {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
      title,
      message,
      module: 'CAPA Preventive Action',
      record_id: capaId,
      user_id: userId,
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('capa preventive action notify', e);
  }
}

export async function assertApprovedRcaForPreventiveAction(capaId: string): Promise<void> {
  const investigation = await getCapaInvestigationByCapaId(capaId);
  if (!investigation || !isInvestigationApproved(investigation.status)) {
    throw new Error('Approved RCA is required before creating preventive actions.');
  }
}

export async function generatePreventiveActionId(): Promise<string> {
  const year = new Date().getFullYear();
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  try {
    const prefix = `PA-CAPA/${year}/`;
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions),
      where('preventive_action_id', '>=', prefix),
      where('preventive_action_id', '<=', `${prefix}\uf8ff`),
      orderBy('preventive_action_id', 'desc'),
      limit(1),
    ));
    if (!snap.empty) {
      const last = String(snap.docs[0].data().preventive_action_id || '');
      const seq = parseInt(last.split('/').pop() || '0', 10) + 1;
      return `PA-CAPA/${year}/${String(seq).padStart(4, '0')}`;
    }
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions));
      return `PA-CAPA/${year}/${String(snap.size + 1).padStart(4, '0')}`;
    } catch {
      throw new Error('Unable to generate preventive action ID from backend.');
    }
  }
  throw new Error('Unable to generate preventive action ID from backend.');
}

async function nextPreventiveActionNumber(capaId: string, capaNumber: string): Promise<string> {
  if (!isFirebaseConfigured()) return buildPreventiveActionNumber(capaNumber, 1);
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions),
    where('capa_id', '==', capaId),
    where('is_deleted', '==', false),
  ));
  return buildPreventiveActionNumber(capaNumber, snap.size + 1);
}

export async function listCapaPreventiveActions(capaId?: string, max = 200): Promise<CapaPreventiveAction[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const q = capaId
      ? query(
        collection(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions),
        where('capa_id', '==', capaId),
        where('is_deleted', '==', false),
        orderBy('updated_at', 'desc'),
        limit(max),
      )
      : query(
        collection(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions),
        where('is_deleted', '==', false),
        orderBy('updated_at', 'desc'),
        limit(max),
      );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => applyPreventiveActionOverdueCheck({ id: d.id, ...d.data() } as CapaPreventiveAction))
      .filter((a) => !a.is_deleted);
  } catch {
    try {
      const snap = await getDocs(capaId
        ? query(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions), where('capa_id', '==', capaId))
        : collection(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions));
      return snap.docs
        .map((d) => applyPreventiveActionOverdueCheck({ id: d.id, ...d.data() } as CapaPreventiveAction))
        .filter((a) => !a.is_deleted);
    } catch {
      return [];
    }
  }
}

export async function fetchCapaPreventiveActionDashboard(): Promise<{
  actions: (CapaPreventiveAction & { capa?: CapaRecord | null })[];
  metrics: CapaPreventiveActionDashboardMetrics;
  error?: string;
}> {
  if (!isFirebaseConfigured()) {
    return { actions: [], metrics: computePreventiveActionDashboardMetrics([]), error: 'Firebase is not configured.' };
  }
  try {
    await syncOverduePreventiveActions();
    const actions = await listCapaPreventiveActions();
    const withCapa = await Promise.all(actions.map(async (a) => ({
      ...a,
      capa: await getCapaById(a.capa_id),
    })));
    return { actions: withCapa, metrics: computePreventiveActionDashboardMetrics(actions) };
  } catch (e) {
    return {
      actions: [],
      metrics: computePreventiveActionDashboardMetrics([]),
      error: e instanceof Error ? e.message : 'Failed to load preventive actions',
    };
  }
}

export async function fetchCapaPreventiveActionPageData(capaId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const [capa, investigation, auditLogs] = await Promise.all([
      getCapaById(capaId),
      getCapaInvestigationByCapaId(capaId),
      getAuditLogsForPreventiveActions(capaId),
    ]);
    if (!capa) return { error: 'CAPA record not found.' };
    await syncOverduePreventiveActions(capaId);
    const actions = await listCapaPreventiveActions(capaId);
    return { capa, actions, investigation, auditLogs };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load preventive actions' };
  }
}

export async function getAuditLogsForPreventiveActions(capaId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.auditLogs),
      where('recordId', '==', capaId),
      limit(100),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function getPreventiveActionById(actionId: string): Promise<CapaPreventiveAction | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions, actionId));
    if (!snap.exists() || snap.data()?.is_deleted) return null;
    return applyPreventiveActionOverdueCheck({ id: snap.id, ...snap.data() } as CapaPreventiveAction);
  } catch {
    return null;
  }
}

export async function createCapaPreventiveAction(
  input: CapaPreventiveActionFormInput,
  actor: CapaPreventiveActionActor,
): Promise<CapaPreventiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  await assertApprovedRcaForPreventiveAction(input.capa_id);

  const capa = await getCapaById(input.capa_id);
  if (!capa) throw new Error('CAPA not found');

  const investigation = await getCapaInvestigationByCapaId(input.capa_id);
  const ts = nowIso();
  const preventiveActionId = await generatePreventiveActionId();
  const actionNumber = await nextPreventiveActionNumber(capa.id, capa.capa_number);

  const payload: Omit<CapaPreventiveAction, 'id'> = {
    preventive_action_id: preventiveActionId,
    capa_id: capa.id,
    capa_number: capa.capa_number,
    action_number: actionNumber,
    risk_reference: input.risk_reference || capa.source_reference_number || '',
    root_cause_reference: input.root_cause_reference || investigation?.root_cause_description || capa.root_cause || '',
    preventive_action_description: input.preventive_action_description,
    objective: input.objective,
    expected_outcome: input.expected_outcome || '',
    action_owner: input.action_owner,
    action_owner_name: input.action_owner_name || '',
    department: input.department,
    priority: input.priority,
    risk_level: input.risk_level || 'medium',
    target_completion_date: input.target_completion_date,
    actual_completion_date: null,
    implementation_status: 'not_started',
    implementation_evidence: '',
    evidence_items: [],
    training_required: input.training_required ?? false,
    training_reference: '',
    training_record_id: null,
    sop_revision_required: input.sop_revision_required ?? false,
    sop_reference: '',
    sop_record_id: null,
    change_control_required: input.change_control_required ?? false,
    change_control_reference: '',
    change_control_id: null,
    verification_required: input.verification_required ?? true,
    verified_by: '',
    verified_by_name: '',
    verification_date: null,
    verification_comments: '',
    qa_review_comments: '',
    action_status: 'draft',
    remarks: input.remarks || '',
    is_deleted: false,
    created_at: ts,
    updated_at: ts,
    created_by: actor.id,
    created_by_name: actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };

  const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions), payload);
  await audit(actor, 'PREVENTIVE_ACTION_CREATED', capa.id, `${preventiveActionId} created`, ref.id);
  return { id: ref.id, ...payload };
}

export async function assignCapaPreventiveAction(
  actionId: string,
  data: { action_owner: string; action_owner_name: string },
  actor: CapaPreventiveActionActor,
): Promise<CapaPreventiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getPreventiveActionById(actionId);
  if (!existing) throw new Error('Preventive action not found');

  const payload = {
    action_owner: data.action_owner,
    action_owner_name: data.action_owner_name,
    action_status: 'assigned',
    implementation_status: 'not_started',
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions, actionId), payload);
  await audit(actor, 'PREVENTIVE_ACTION_ASSIGNED', existing.capa_id, `Assigned to ${data.action_owner_name}`, actionId);

  const capa = await getCapaById(existing.capa_id);
  await notify(
    'Preventive Action Assigned',
    `You have been assigned preventive action ${existing.action_number} for CAPA ${existing.capa_number}`,
    existing.capa_id,
    data.action_owner,
  );
  if (capa) {
    await notify(
      'Preventive Action — Department Review',
      `Preventive action ${existing.action_number} assigned (${existing.department})`,
      existing.capa_id,
      capa.created_by,
    );
  }
  return { ...existing, ...payload };
}

export async function updateCapaPreventiveActionImplementation(
  actionId: string,
  input: CapaPreventiveActionImplementationInput,
  actor: CapaPreventiveActionActor,
): Promise<CapaPreventiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getPreventiveActionById(actionId);
  if (!existing) throw new Error('Preventive action not found');

  const newActionStatus = input.implementation_status === 'implemented'
    ? 'implemented'
    : 'under_implementation';

  const payload = {
    implementation_status: input.implementation_status,
    implementation_evidence: input.implementation_evidence,
    actual_completion_date: input.actual_completion_date || today(),
    action_status: newActionStatus,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions, actionId), payload);
  await audit(actor, 'IMPLEMENTATION_UPDATED', existing.capa_id, input.implementation_status, actionId);

  const capa = await getCapaById(existing.capa_id);
  if (input.implementation_status === 'implemented' && capa) {
    await notify(
      'Preventive Action Implemented',
      `Preventive action ${existing.action_number} implemented — CAPA ${existing.capa_number}`,
      existing.capa_id,
      capa.qa_reviewer || capa.created_by || '',
    );
  }
  return { ...existing, ...payload };
}

export async function linkCapaPreventiveActionTraining(
  actionId: string,
  input: CapaPreventiveActionLinkInput,
  actor: CapaPreventiveActionActor,
): Promise<CapaPreventiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getPreventiveActionById(actionId);
  if (!existing) throw new Error('Preventive action not found');

  const payload = {
    training_required: true,
    training_reference: input.reference,
    training_record_id: input.record_id || null,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions, actionId), payload);
  await audit(actor, 'TRAINING_LINKED', existing.capa_id, input.reference, actionId);
  await notify(
    'Preventive Action Training Linked',
    `Training ${input.reference} linked to ${existing.action_number}`,
    existing.capa_id,
    'training_coordinator',
  );
  return { ...existing, ...payload };
}

export async function linkCapaPreventiveActionSop(
  actionId: string,
  input: CapaPreventiveActionLinkInput,
  actor: CapaPreventiveActionActor,
): Promise<CapaPreventiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getPreventiveActionById(actionId);
  if (!existing) throw new Error('Preventive action not found');

  const payload = {
    sop_revision_required: true,
    sop_reference: input.reference,
    sop_record_id: input.record_id || null,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions, actionId), payload);
  await audit(actor, 'SOP_LINKED', existing.capa_id, input.reference, actionId);
  await notify(
    'Preventive Action SOP Linked',
    `SOP ${input.reference} linked to ${existing.action_number}`,
    existing.capa_id,
    'document_controller',
  );
  return { ...existing, ...payload };
}

export async function linkCapaPreventiveActionChangeControl(
  actionId: string,
  input: CapaPreventiveActionLinkInput,
  actor: CapaPreventiveActionActor,
): Promise<CapaPreventiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getPreventiveActionById(actionId);
  if (!existing) throw new Error('Preventive action not found');

  const payload = {
    change_control_required: true,
    change_control_reference: input.reference,
    change_control_id: input.record_id || null,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions, actionId), payload);
  await audit(actor, 'CHANGE_CONTROL_LINKED', existing.capa_id, input.reference, actionId);
  return { ...existing, ...payload };
}

export async function uploadCapaPreventiveActionEvidence(
  actionId: string,
  fileName: string,
  description: string,
  actor: CapaPreventiveActionActor,
): Promise<CapaPreventiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getPreventiveActionById(actionId);
  if (!existing) throw new Error('Preventive action not found');

  const item = {
    id: `ev-${Date.now()}`,
    file_name: fileName,
    description: description || 'Attachment placeholder',
    file_url: '',
    uploaded_at: nowIso(),
    uploaded_by: actor.id,
    uploaded_by_name: actor.name,
  };
  const evidenceItems = [...(existing.evidence_items || []), item];
  const payload = {
    evidence_items: evidenceItems,
    implementation_evidence: existing.implementation_evidence || description || `Evidence: ${fileName}`,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions, actionId), payload);
  await audit(actor, 'EVIDENCE_UPLOADED', existing.capa_id, fileName, actionId);
  return { ...existing, ...payload };
}

export async function submitCapaPreventiveActionForVerification(
  actionId: string,
  actor: CapaPreventiveActionActor,
): Promise<CapaPreventiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getPreventiveActionById(actionId);
  if (!existing) throw new Error('Preventive action not found');
  if (!hasRequiredPreventiveEvidence(existing)) {
    throw new Error('Implementation evidence is required before QA verification.');
  }

  const payload = {
    action_status: 'qa_verification',
    implementation_status: 'implemented',
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions, actionId), payload);
  await audit(actor, 'SUBMITTED_FOR_VERIFICATION', existing.capa_id, existing.action_number, actionId);

  const capa = await getCapaById(existing.capa_id);
  await notify(
    'Preventive Action QA Verification',
    `Preventive action ${existing.action_number} submitted for QA verification`,
    existing.capa_id,
    capa?.qa_reviewer || capa?.created_by || '',
  );
  return { ...existing, ...payload };
}

export async function verifyCapaPreventiveAction(
  actionId: string,
  input: CapaPreventiveActionVerificationInput,
  actor: CapaPreventiveActionActor,
): Promise<CapaPreventiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getPreventiveActionById(actionId);
  if (!existing) throw new Error('Preventive action not found');
  if (!canApproveCriticalCapaPreventiveAction(actor.role, existing.priority)) {
    throw new Error('Head QA approval required for critical preventive actions.');
  }

  const approved = input.decision === 'approved';
  const ts = nowIso();
  const payload = {
    action_status: approved ? 'approved' : 'rejected',
    implementation_status: approved ? 'implemented' : 'rejected',
    verification_comments: input.verification_comments,
    qa_review_comments: input.qa_review_comments || input.verification_comments,
    verified_by: actor.id,
    verified_by_name: actor.name,
    verification_date: ts.split('T')[0],
    updated_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions, actionId), payload);
  await audit(
    actor,
    approved ? 'PREVENTIVE_ACTION_APPROVED' : 'PREVENTIVE_ACTION_REJECTED',
    existing.capa_id,
    input.verification_comments,
    actionId,
  );

  if (!approved) {
    await notify(
      'Preventive Action Rejected',
      `Preventive action ${existing.action_number} rejected by QA`,
      existing.capa_id,
      existing.action_owner,
    );
  } else {
    await notify(
      'Preventive Action Approved',
      `Preventive action ${existing.action_number} approved by QA`,
      existing.capa_id,
      existing.action_owner,
    );
  }
  return { ...existing, ...payload };
}

export async function closeCapaPreventiveAction(
  actionId: string,
  actor: CapaPreventiveActionActor,
): Promise<CapaPreventiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getPreventiveActionById(actionId);
  if (!existing) throw new Error('Preventive action not found');
  if (existing.action_status !== 'approved') {
    throw new Error('QA verification and approval required before action closure.');
  }

  const closureErrors = validatePreventiveActionClosureRequirements(existing);
  if (closureErrors.length) {
    throw new Error(closureErrors[0]);
  }

  const payload = {
    action_status: 'closed',
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions, actionId), payload);
  await audit(actor, 'PREVENTIVE_ACTION_CLOSED', existing.capa_id, existing.action_number, actionId);
  return { ...existing, ...payload };
}

export async function syncOverduePreventiveActions(capaId?: string): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  const actions = await listCapaPreventiveActions(capaId, 500);
  const todayStr = today();
  let count = 0;
  for (const action of actions) {
    if (['closed', 'approved', 'overdue'].includes(action.action_status)) continue;
    if (action.target_completion_date && action.target_completion_date < todayStr) {
      await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.preventiveActions, action.id), {
        action_status: 'overdue',
        updated_at: nowIso(),
      });
      await audit(
        { id: 'system', name: 'System', role: 'system' },
        'PREVENTIVE_ACTION_OVERDUE',
        action.capa_id,
        action.action_number,
        action.id,
      );
      count++;
    }
  }
  return count;
}

export async function fetchTrainingRecordOptions(max = 50): Promise<{ id: string; reference: string; title: string }[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.trainingRecords),
      limit(max),
    ));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        reference: String(data.training_number || data.reference || data.id),
        title: String(data.training_title || data.title || data.name || ''),
      };
    });
  } catch {
    return [];
  }
}

export async function fetchSopRecordOptions(max = 50): Promise<{ id: string; reference: string; title: string }[]> {
  try {
    const { fetchSopOptionsForCapa } = await import('@/lib/sop-service');
    const options = await fetchSopOptionsForCapa(max);
    if (options.length) return options;
  } catch { /* fall through to legacy */ }
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.sopManagement),
      limit(max),
    ));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        reference: String(data.sop_number || data.document_number || data.reference || d.id),
        title: String(data.sop_title || data.title || data.name || ''),
      };
    });
  } catch {
    return [];
  }
}

export async function fetchChangeControlOptions(max = 50): Promise<{ id: string; reference: string; title: string }[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.changeControls),
      limit(max),
    ));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        reference: String(data.change_control_number || data.cc_number || d.id),
        title: String(data.title || data.change_description || ''),
      };
    });
  } catch {
    return [];
  }
}

export { computePreventiveActionDashboardMetrics };

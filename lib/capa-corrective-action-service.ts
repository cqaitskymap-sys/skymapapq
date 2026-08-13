import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  applyCorrectiveActionOverdueCheck,
  buildActionNumber,
  canApproveCriticalCapaCorrectiveAction,
  CAPA_CORRECTIVE_ACTION_MODULE,
  computeCorrectiveActionDashboardMetrics,
  hasRequiredEvidence,
  type CapaCorrectiveActionActor,
  type CapaCorrectiveActionFormInput,
  type CapaCorrectiveActionImplementationInput,
  type CapaCorrectiveActionVerificationInput,
} from '@/lib/capa-corrective-action-records';
import { getCapaInvestigationByCapaId } from '@/lib/capa-investigation-service';
import { isInvestigationApproved } from '@/lib/capa-investigation-records';
import { getCapaById, updateCapa } from '@/lib/capa-service';
import {
  CAPA_COLLECTIONS,
  type CapaCorrectiveAction,
  type CapaCorrectiveActionDashboardMetrics,
  type CapaRecord,
} from '@/lib/capa-types';

export type {
  CapaCorrectiveActionActor,
  CapaCorrectiveActionFormInput,
  CapaCorrectiveActionImplementationInput,
  CapaCorrectiveActionVerificationInput,
};

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

async function audit(
  actor: CapaCorrectiveActionActor,
  actionType: string,
  capaId: string,
  detail?: string,
  recordId?: string,
) {
  try {
    await createAuditLog({
      moduleName: CAPA_CORRECTIVE_ACTION_MODULE,
      collectionName: CAPA_COLLECTIONS.correctiveActions,
      recordId: recordId || capaId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('capa corrective action audit', e);
  }
}

async function notify(title: string, message: string, capaId: string, userId: string) {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
      title,
      message,
      module: 'CAPA Corrective Action',
      record_id: capaId,
      user_id: userId,
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('capa corrective action notify', e);
  }
}

export async function assertApprovedRcaForCorrectiveAction(capaId: string): Promise<void> {
  const investigation = await getCapaInvestigationByCapaId(capaId);
  if (!investigation || !isInvestigationApproved(investigation.status)) {
    throw new Error('Approved RCA is required before creating corrective actions.');
  }
}

export async function generateCorrectiveActionId(): Promise<string> {
  const year = new Date().getFullYear();
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  try {
    const prefix = `CA-CAPA/${year}/`;
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions),
      where('corrective_action_id', '>=', prefix),
      where('corrective_action_id', '<=', `${prefix}\uf8ff`),
      orderBy('corrective_action_id', 'desc'),
      limit(1),
    ));
    if (!snap.empty) {
      const last = String(snap.docs[0].data().corrective_action_id || '');
      const seq = parseInt(last.split('/').pop() || '0', 10) + 1;
      return `CA-CAPA/${year}/${String(seq).padStart(4, '0')}`;
    }
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions));
      return `CA-CAPA/${year}/${String(snap.size + 1).padStart(4, '0')}`;
    } catch {
      throw new Error('Unable to generate corrective action ID from backend.');
    }
  }
  throw new Error('Unable to generate corrective action ID from backend.');
}

async function nextActionNumber(capaId: string, capaNumber: string): Promise<string> {
  if (!isFirebaseConfigured()) return buildActionNumber(capaNumber, 1);
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions),
    where('capa_id', '==', capaId),
    where('is_deleted', '==', false),
  ));
  return buildActionNumber(capaNumber, snap.size + 1);
}

export async function listCapaCorrectiveActions(capaId?: string, max = 200): Promise<CapaCorrectiveAction[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const q = capaId
      ? query(
        collection(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions),
        where('capa_id', '==', capaId),
        where('is_deleted', '==', false),
        orderBy('updated_at', 'desc'),
        limit(max),
      )
      : query(
        collection(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions),
        where('is_deleted', '==', false),
        orderBy('updated_at', 'desc'),
        limit(max),
      );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => applyCorrectiveActionOverdueCheck({ id: d.id, ...d.data() } as CapaCorrectiveAction))
      .filter((a) => !a.is_deleted);
  } catch (e) {
    if (capaId) {
      try {
        const snap = await getDocs(query(
          collection(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions),
          where('capa_id', '==', capaId),
        ));
        return snap.docs
          .map((d) => applyCorrectiveActionOverdueCheck({ id: d.id, ...d.data() } as CapaCorrectiveAction))
          .filter((a) => !a.is_deleted);
      } catch {
        return [];
      }
    }
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions));
      return snap.docs
        .map((d) => applyCorrectiveActionOverdueCheck({ id: d.id, ...d.data() } as CapaCorrectiveAction))
        .filter((a) => !a.is_deleted);
    } catch {
      console.error('listCapaCorrectiveActions', e);
      return [];
    }
  }
}

export async function fetchCapaCorrectiveActionDashboard(): Promise<{
  actions: (CapaCorrectiveAction & { capa?: CapaRecord | null })[];
  metrics: CapaCorrectiveActionDashboardMetrics;
  error?: string;
}> {
  if (!isFirebaseConfigured()) {
    return { actions: [], metrics: computeCorrectiveActionDashboardMetrics([]), error: 'Firebase is not configured.' };
  }
  try {
    await syncOverdueCorrectiveActions();
    const actions = await listCapaCorrectiveActions();
    const withCapa = await Promise.all(actions.map(async (a) => ({
      ...a,
      capa: await getCapaById(a.capa_id),
    })));
    return {
      actions: withCapa,
      metrics: computeCorrectiveActionDashboardMetrics(actions),
    };
  } catch (e) {
    return {
      actions: [],
      metrics: computeCorrectiveActionDashboardMetrics([]),
      error: e instanceof Error ? e.message : 'Failed to load corrective actions',
    };
  }
}

export async function fetchCapaCorrectiveActionPageData(capaId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const [capa, actions, investigation, auditLogs] = await Promise.all([
      getCapaById(capaId),
      listCapaCorrectiveActions(capaId),
      getCapaInvestigationByCapaId(capaId),
      getAuditLogsForCorrectiveActions(capaId),
    ]);
    if (!capa) return { error: 'CAPA record not found.' };
    await syncOverdueCorrectiveActions(capaId);
    const refreshed = await listCapaCorrectiveActions(capaId);
    return { capa, actions: refreshed, investigation, auditLogs };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load corrective actions' };
  }
}

export async function getAuditLogsForCorrectiveActions(capaId: string) {
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

export async function createCapaCorrectiveAction(
  input: CapaCorrectiveActionFormInput,
  actor: CapaCorrectiveActionActor,
): Promise<CapaCorrectiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  await assertApprovedRcaForCorrectiveAction(input.capa_id);

  const capa = await getCapaById(input.capa_id);
  if (!capa) throw new Error('CAPA not found');

  const investigation = await getCapaInvestigationByCapaId(input.capa_id);
  const ts = nowIso();
  const correctiveActionId = await generateCorrectiveActionId();
  const actionNumber = await nextActionNumber(capa.id, capa.capa_number);

  const payload: Omit<CapaCorrectiveAction, 'id'> = {
    corrective_action_id: correctiveActionId,
    capa_id: capa.id,
    capa_number: capa.capa_number,
    action_number: actionNumber,
    root_cause_reference: input.root_cause_reference || investigation?.root_cause_description || capa.root_cause || '',
    corrective_action_description: input.corrective_action_description,
    action_owner: input.action_owner,
    action_owner_name: input.action_owner_name || '',
    department: input.department,
    priority: input.priority,
    target_completion_date: input.target_completion_date,
    actual_completion_date: null,
    implementation_status: 'not_started',
    implementation_evidence: '',
    evidence_items: [],
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

  const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions), payload);
  await audit(actor, 'CORRECTIVE_ACTION_CREATED', capa.id, `${correctiveActionId} created`, ref.id);
  return { id: ref.id, ...payload };
}

export async function assignCapaCorrectiveAction(
  actionId: string,
  data: { action_owner: string; action_owner_name: string },
  actor: CapaCorrectiveActionActor,
): Promise<CapaCorrectiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getCorrectiveActionById(actionId);
  if (!existing) throw new Error('Corrective action not found');

  const payload = {
    action_owner: data.action_owner,
    action_owner_name: data.action_owner_name,
    action_status: 'assigned',
    implementation_status: 'not_started',
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions, actionId), payload);
  await audit(actor, 'CORRECTIVE_ACTION_ASSIGNED', existing.capa_id, `Assigned to ${data.action_owner_name}`, actionId);
  await notify(
    'Corrective Action Assigned',
    `You have been assigned corrective action ${existing.action_number} for CAPA ${existing.capa_number}`,
    existing.capa_id,
    data.action_owner,
  );
  return { ...existing, ...payload };
}

export async function getCorrectiveActionById(actionId: string): Promise<CapaCorrectiveAction | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions, actionId));
    if (!snap.exists() || snap.data()?.is_deleted) return null;
    return applyCorrectiveActionOverdueCheck({ id: snap.id, ...snap.data() } as CapaCorrectiveAction);
  } catch {
    return null;
  }
}

export async function updateCapaCorrectiveActionImplementation(
  actionId: string,
  input: CapaCorrectiveActionImplementationInput,
  actor: CapaCorrectiveActionActor,
): Promise<CapaCorrectiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getCorrectiveActionById(actionId);
  if (!existing) throw new Error('Corrective action not found');

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
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions, actionId), payload);
  await audit(actor, 'IMPLEMENTATION_UPDATED', existing.capa_id, input.implementation_status, actionId);

  const capa = await getCapaById(existing.capa_id);
  if (input.implementation_status === 'implemented' && capa) {
    await notify(
      'Corrective Action Implemented',
      `Corrective action ${existing.action_number} implementation updated — CAPA ${existing.capa_number}`,
      existing.capa_id,
      capa.qa_reviewer || capa.created_by || '',
    );
  }
  if (capa && newActionStatus === 'under_implementation') {
    await updateCapa(existing.capa_id, { capa_status: 'under_implementation' }, {
      id: actor.id, name: actor.name, role: actor.role || '',
    }, { workflow: true });
  }
  return { ...existing, ...payload };
}

export async function uploadCapaCorrectiveActionEvidence(
  actionId: string,
  fileName: string,
  description: string,
  actor: CapaCorrectiveActionActor,
): Promise<CapaCorrectiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getCorrectiveActionById(actionId);
  if (!existing) throw new Error('Corrective action not found');

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
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions, actionId), payload);
  await audit(actor, 'EVIDENCE_UPLOADED', existing.capa_id, fileName, actionId);
  return { ...existing, ...payload };
}

export async function submitCapaCorrectiveActionForVerification(
  actionId: string,
  actor: CapaCorrectiveActionActor,
): Promise<CapaCorrectiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getCorrectiveActionById(actionId);
  if (!existing) throw new Error('Corrective action not found');
  if (!hasRequiredEvidence({ ...existing, implementation_evidence: existing.implementation_evidence })) {
    throw new Error('Implementation evidence is required before QA verification.');
  }

  const payload = {
    action_status: 'qa_verification',
    implementation_status: 'implemented',
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions, actionId), payload);
  await audit(actor, 'SUBMITTED_FOR_VERIFICATION', existing.capa_id, existing.action_number, actionId);

  const capa = await getCapaById(existing.capa_id);
  await notify(
    'Corrective Action QA Verification',
    `Corrective action ${existing.action_number} submitted for QA verification — CAPA ${existing.capa_number}`,
    existing.capa_id,
    capa?.qa_reviewer || capa?.created_by || '',
  );
  return { ...existing, ...payload };
}

export async function verifyCapaCorrectiveAction(
  actionId: string,
  input: CapaCorrectiveActionVerificationInput,
  actor: CapaCorrectiveActionActor,
): Promise<CapaCorrectiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getCorrectiveActionById(actionId);
  if (!existing) throw new Error('Corrective action not found');
  if (!canApproveCriticalCapaCorrectiveAction(actor.role, existing.priority)) {
    throw new Error('Head QA approval required for critical corrective actions.');
  }

  const ts = nowIso();
  const approved = input.decision === 'approved';
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
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions, actionId), payload);
  await audit(
    actor,
    approved ? 'CORRECTIVE_ACTION_APPROVED' : 'CORRECTIVE_ACTION_REJECTED',
    existing.capa_id,
    input.verification_comments,
    actionId,
  );

  if (!approved) {
    await updateCapa(existing.capa_id, { capa_status: 'under_implementation' }, {
      id: actor.id, name: actor.name, role: actor.role || '',
    }, { workflow: true });
    await notify(
      'Corrective Action Rejected',
      `Corrective action ${existing.action_number} rejected — CAPA returned to Under Implementation`,
      existing.capa_id,
      existing.action_owner,
    );
  } else {
    await notify(
      'Corrective Action Approved',
      `Corrective action ${existing.action_number} approved by QA`,
      existing.capa_id,
      existing.action_owner,
    );
  }
  return { ...existing, ...payload };
}

export async function closeCapaCorrectiveAction(
  actionId: string,
  actor: CapaCorrectiveActionActor,
): Promise<CapaCorrectiveAction> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getCorrectiveActionById(actionId);
  if (!existing) throw new Error('Corrective action not found');
  if (existing.action_status !== 'approved') {
    throw new Error('QA verification and approval required before action closure.');
  }

  const payload = {
    action_status: 'closed',
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions, actionId), payload);
  await audit(actor, 'CORRECTIVE_ACTION_CLOSED', existing.capa_id, existing.action_number, actionId);
  return { ...existing, ...payload };
}

export async function syncOverdueCorrectiveActions(capaId?: string): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  const actions = await listCapaCorrectiveActions(capaId, 500);
  const todayStr = today();
  let count = 0;
  for (const action of actions) {
    if (['closed', 'approved', 'overdue'].includes(action.action_status)) continue;
    if (action.target_completion_date && action.target_completion_date < todayStr) {
      await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.correctiveActions, action.id), {
        action_status: 'overdue',
        updated_at: nowIso(),
      });
      await audit(
        { id: 'system', name: 'System', role: 'system' },
        'CORRECTIVE_ACTION_OVERDUE',
        action.capa_id,
        action.action_number,
        action.id,
      );
      count++;
    }
  }
  return count;
}

export { computeCorrectiveActionDashboardMetrics };

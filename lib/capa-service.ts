import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured } from '@/lib/firebase';
import { logAuditEvent } from '@/lib/admin/admin-service';
import { downloadCsv } from '@/lib/export-utils';
import {
  CAPA_COLLECTIONS, type CapaRecord, type CapaAction, type CapaEffectiveness,
  type CapaApproval, type CapaAttachment, type CapaSourceLink, type CapaFilters,
  type CapaDashboardMetrics, type CapaActor, isCapaClosed, requiresHeadQaApproval,
} from './capa-types';
import { generateDocumentNumber } from '@/lib/admin/document-numbering-service';
import { computeExtendedCapaDashboardMetrics } from './capa-dashboard-records';
import type { CapaCreateInput } from './capa-schemas';

function now() { return new Date().toISOString(); }

async function audit(
  actor: CapaActor, action: string, recordId: string,
  oldValue: unknown, newValue: unknown, reason = '',
) {
  await logAuditEvent({
    userId: actor.id,
    userName: actor.name,
    module: 'CAPA',
    recordId,
    action,
    oldValue: oldValue ? JSON.stringify(oldValue) : '',
    newValue: newValue ? JSON.stringify(newValue) : '',
    reason,
    ipAddress: typeof window !== 'undefined' ? 'client' : 'server',
    device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
    status: 'Success',
  });
}

async function notify(title: string, message: string, capaId: string, userId: string) {
  try {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
      title, message, module: 'CAPA', record_id: capaId, user_id: userId,
      read: false, created_at: now(),
    });
  } catch (e) {
    console.error('Notification failed:', e);
  }
}

export async function generateCapaNumber(): Promise<string> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured.');
  }
  try {
    const result = await generateDocumentNumber('CAPA', 'Corrective Action', {
      departmentCode: 'QA',
      increment: true,
    });
    if (result.number) return result.number;
  } catch (e) {
    console.error('generateCapaNumber document numbering', e);
  }
  throw new Error('Unable to generate CAPA number from backend configuration.');
}

async function resolveSourceLinks(
  source: string,
  sourceRef: string,
): Promise<Partial<CapaRecord>> {
  const links: Partial<CapaRecord> = {
    deviation_id: null, oos_id: null, cpv_risk_id: null,
    change_control_id: null, pqr_id: null, batch_id: null,
    complaint_id: null, audit_id: null,
  };

  const findByNumber = async (coll: string, field: string) => {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), coll),
      where(field, '==', sourceRef),
      limit(1),
    ));
    return snap.empty ? null : snap.docs[0];
  };

  try {
    if (source === 'Deviation') {
      const d = await findByNumber(CAPA_COLLECTIONS.deviations, 'deviation_number');
      if (d) {
        links.deviation_id = d.id;
        const data = d.data();
        links.product_name = links.product_name || (data.product_name as string) || '';
        links.batch_number = links.batch_number || (data.batch_number as string) || '';
        links.pqr_id = (data.pqr_id as string) || null;
        links.batch_id = (data.batch_id as string) || null;
      }
    }
    if (source === 'OOS') {
      const o = await findByNumber(CAPA_COLLECTIONS.oos, 'oos_number');
      if (o) {
        links.oos_id = o.id;
        const data = o.data();
        links.product_name = links.product_name || (data.product_name as string) || '';
        links.batch_number = links.batch_number || (data.batch_number as string) || '';
        links.batch_id = (data.batch_id as string) || null;
      }
    }
    if (source === 'CPV Risk') {
      const r = await findByNumber(CAPA_COLLECTIONS.risks, 'riskId');
      if (!r) {
        const alt = await getDocs(query(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.risks), limit(50)));
        const match = alt.docs.find((d) => d.data().riskId === sourceRef || d.data().risk_id === sourceRef);
        if (match) links.cpv_risk_id = match.id;
      } else {
        links.cpv_risk_id = r.id;
      }
    }
    if (source === 'Market Complaint') {
      const c = await findByNumber(CAPA_COLLECTIONS.complaints, 'complaint_number');
      if (c) {
        links.complaint_id = c.id;
        const data = c.data();
        links.product_name = links.product_name || (data.product_name as string) || '';
        links.batch_number = links.batch_number || (data.batch_number as string) || '';
      }
    }
    if (source === 'Change Control') {
      const cc = await findByNumber(CAPA_COLLECTIONS.changeControls, 'change_control_number');
      if (cc) {
        links.change_control_id = cc.id;
        const data = cc.data();
        links.department = links.department || (data.department as string) || undefined;
      }
    }
    if (source === 'Audit') {
      const a = await findByNumber(CAPA_COLLECTIONS.audits, 'audit_number');
      if (a) {
        links.audit_id = a.id;
        const data = a.data();
        links.department = links.department || (data.department as string) || undefined;
      }
    }
    if (links.batch_number && !links.batch_id) {
      const b = await findByNumber(CAPA_COLLECTIONS.batches, 'batch_number');
      if (b) {
        links.batch_id = b.id;
        links.pqr_id = (b.data().pqr_id as string) || links.pqr_id || null;
      }
    }
  } catch (e) {
    console.warn('Source link resolution partial:', e);
  }
  return links;
}

async function writeSourceLink(capaId: string, source: string, sourceId: string, sourceNumber: string, actor: CapaActor) {
  await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.sourceLinks), {
    capa_id: capaId,
    source_type: source,
    source_id: sourceId,
    source_number: sourceNumber,
    linked_at: now(),
    linked_by: actor.id,
    linked_by_name: actor.name,
  });
}

export async function createCapa(
  input: CapaCreateInput & { action_owner_name?: string },
  actor: CapaActor,
  options?: { status?: string; deviation_id?: string; oos_id?: string; cpv_risk_id?: string },
): Promise<CapaRecord> {
  const capaNumber = await generateCapaNumber();
  const timestamp = now();
  const sourceLinks = await resolveSourceLinks(input.capa_source, input.source_reference_number);

  const autoRules = requiresHeadQaApproval(input.priority || 'medium');

  const record: Omit<CapaRecord, 'id'> = {
    capa_number: capaNumber,
    capa_date: input.capa_date,
    capa_source: input.capa_source,
    source_reference_number: input.source_reference_number,
    department: input.department,
    product_name: input.product_name || sourceLinks.product_name || '',
    batch_number: input.batch_number || sourceLinks.batch_number || '',
    capa_title: input.capa_title,
    problem_description: input.problem_description,
    root_cause: input.root_cause || '',
    corrective_action: input.corrective_action || '',
    preventive_action: input.preventive_action || '',
    action_owner: input.action_owner,
    action_owner_name: input.action_owner_name || input.action_owner,
    target_completion_date: input.target_completion_date,
    actual_completion_date: null,
    effectiveness_check_required: input.effectiveness_check_required,
    effectiveness_check_date: (input as CapaCreateInput & { effectiveness_check_date?: string }).effectiveness_check_date || null,
    effectiveness_criteria: input.effectiveness_criteria || '',
    effectiveness_result: input.effectiveness_check_required ? 'Pending' : 'N/A',
    capa_status: options?.status || 'draft',
    qa_remarks: input.qa_remarks || '',
    priority: input.priority || 'medium',
    criticality: (input as CapaCreateInput & { criticality?: string }).criticality
      || (input.priority === 'critical' ? 'Critical' : input.priority === 'high' ? 'High' : input.priority === 'medium' ? 'Medium' : 'Low'),
    qa_reviewer: (input as CapaCreateInput & { qa_reviewer?: string }).qa_reviewer || '',
    qa_reviewer_name: (input as CapaCreateInput & { qa_reviewer_name?: string }).qa_reviewer_name || '',
    head_qa_approval_required: autoRules,
    deviation_id: options?.deviation_id || sourceLinks.deviation_id || null,
    oos_id: options?.oos_id || sourceLinks.oos_id || null,
    cpv_risk_id: options?.cpv_risk_id || sourceLinks.cpv_risk_id || null,
    change_control_id: sourceLinks.change_control_id || null,
    pqr_id: sourceLinks.pqr_id || null,
    complaint_id: sourceLinks.complaint_id || null,
    audit_id: sourceLinks.audit_id || null,
    batch_id: sourceLinks.batch_id || null,
    extension_capa_id: null,
    parent_capa_id: null,
    created_by: actor.id,
    created_by_name: actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.records), record);
  await audit(actor, 'CREATE', ref.id, null, record);

  if (record.deviation_id) {
    await writeSourceLink(ref.id, 'Deviation', record.deviation_id, input.source_reference_number, actor);
    try {
      await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.deviations, record.deviation_id), {
        linked_capa_number: capaNumber,
        linked_capa_id: ref.id,
        capa_required: true,
        status: 'capa_required',
        updated_at: timestamp,
      });
    } catch { /* optional */ }
  }
  if (record.oos_id) {
    await writeSourceLink(ref.id, 'OOS', record.oos_id, input.source_reference_number, actor);
  }
  if (record.cpv_risk_id) {
    await writeSourceLink(ref.id, 'CPV Risk', record.cpv_risk_id, input.source_reference_number, actor);
  }
  if (record.complaint_id) {
    await writeSourceLink(ref.id, 'Market Complaint', record.complaint_id, input.source_reference_number, actor);
  }
  if (record.audit_id) {
    await writeSourceLink(ref.id, 'Audit', record.audit_id, input.source_reference_number, actor);
  }
  if (record.change_control_id) {
    await writeSourceLink(ref.id, 'Change Control', record.change_control_id, input.source_reference_number, actor);
  }

  return { id: ref.id, ...record };
}

export async function getCapaById(id: string): Promise<CapaRecord | null> {
  const snap = await getDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.records, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as CapaRecord;
}

export async function listCapas(filters?: CapaFilters): Promise<CapaRecord[]> {
  if (!isFirebaseConfigured()) return [];
  let q = query(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.records), orderBy('updated_at', 'desc'), limit(1000));
  try {
    const snap = await getDocs(q);
    let records = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CapaRecord));
    if (filters?.status && filters.status !== 'all') {
      records = records.filter((r) => r.capa_status === filters.status);
    }
    if (filters?.source && filters.source !== 'all') {
      records = records.filter((r) => r.capa_source === filters.source);
    }
    if (filters?.department && filters.department !== 'all') {
      records = records.filter((r) => r.department === filters.department);
    }
    if (filters?.priority && filters.priority !== 'all') {
      records = records.filter((r) => r.priority === filters.priority);
    }
    if (filters?.search) {
      const s = filters.search.toLowerCase();
      records = records.filter((r) =>
        (r.capa_number || '').toLowerCase().includes(s)
        || (r.capa_title || '').toLowerCase().includes(s)
        || (r.product_name || '').toLowerCase().includes(s)
        || (r.batch_number || '').toLowerCase().includes(s),
      );
    }
    if (filters?.due_this_week) {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() + 7);
      records = records.filter((r) => {
        if (!r.target_completion_date || isCapaClosed(r.capa_status)) return false;
        const due = new Date(r.target_completion_date);
        return due <= weekEnd;
      });
    }
    return records;
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.records));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CapaRecord));
  }
}

export async function updateCapa(
  id: string,
  patch: Partial<CapaRecord>,
  actor: CapaActor,
  options?: { workflow?: boolean },
): Promise<CapaRecord> {
  const existing = await getCapaById(id);
  if (!existing) throw new Error('CAPA not found');
  if (!options?.workflow && existing.capa_status !== 'draft') {
    throw new Error('Only draft CAPAs can be edited directly');
  }
  const timestamp = now();
  const payload = {
    ...patch,
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: timestamp,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.records, id), payload);
  await audit(actor, 'UPDATE', id, existing, { ...existing, ...payload });
  return { ...existing, ...payload } as CapaRecord;
}

export async function syncOverdueCapas(): Promise<number> {
  const records = await listCapas();
  const today = new Date().toISOString().split('T')[0];
  let count = 0;
  for (const r of records) {
    if (isCapaClosed(r.capa_status) || r.capa_status === 'overdue') continue;
    if (r.target_completion_date && r.target_completion_date < today) {
      await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.records, r.id), {
        capa_status: 'overdue',
        updated_at: now(),
      });
      count++;
    }
  }
  return count;
}

export async function submitCapa(id: string, actor: CapaActor): Promise<CapaRecord> {
  const capa = await getCapaById(id);
  if (!capa) throw new Error('CAPA not found');
  if (capa.capa_status !== 'draft') throw new Error('Only draft CAPAs can be submitted');
  return updateCapa(id, { capa_status: 'submitted' }, actor, { workflow: true });
}

export async function assignCapa(
  id: string,
  data: { action_owner: string; action_owner_name: string },
  actor: CapaActor,
): Promise<CapaRecord> {
  const updated = await updateCapa(id, {
    action_owner: data.action_owner,
    action_owner_name: data.action_owner_name,
    capa_status: 'assigned',
  }, actor, { workflow: true });
  await audit(actor, 'ASSIGN', id, null, data);
  await notify('CAPA Assigned', `CAPA ${updated.capa_number} assigned to ${data.action_owner_name}`, id, data.action_owner);
  return updated;
}

export async function updateRootCause(
  id: string,
  data: { root_cause: string; corrective_action: string; preventive_action: string },
  actor: CapaActor,
): Promise<CapaRecord> {
  const { assertInvestigationApprovedForCapaWorkflow } = await import('./capa-investigation-service');
  await assertInvestigationApprovedForCapaWorkflow(id);
  return updateCapa(id, {
    ...data,
    capa_status: 'under_implementation',
  }, actor, { workflow: true });
}

export async function updateImplementation(
  id: string,
  data: { actual_completion_date: string; implementation_evidence: string },
  actor: CapaActor,
): Promise<CapaRecord> {
  const capa = await getCapaById(id);
  if (!capa) throw new Error('CAPA not found');

  const { assertInvestigationApprovedForCapaWorkflow } = await import('./capa-investigation-service');
  await assertInvestigationApprovedForCapaWorkflow(id);

  const newStatus = capa.effectiveness_check_required ? 'effectiveness_pending' : 'implemented';
  const updated = await updateCapa(id, {
    actual_completion_date: data.actual_completion_date,
    capa_status: newStatus,
  }, actor, { workflow: true });

  await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.actions), {
    capa_id: id,
    action_type: 'implementation',
    description: data.implementation_evidence,
    owner: actor.id,
    owner_name: actor.name,
    target_date: capa.target_completion_date,
    completed_date: data.actual_completion_date,
    status: 'completed',
    evidence: data.implementation_evidence,
    created_at: now(),
    updated_at: now(),
  });

  await audit(actor, 'IMPLEMENTATION_UPDATE', id, null, data);
  return updated;
}

export async function submitEffectiveness(
  id: string,
  data: {
    check_date: string; criteria: string; result: string;
    evidence: string; remarks?: string;
  },
  actor: CapaActor,
): Promise<CapaEffectiveness> {
  const capa = await getCapaById(id);
  if (!capa) throw new Error('CAPA not found');
  if (!capa.effectiveness_check_required) throw new Error('Effectiveness check not required');

  const timestamp = now();
  const eff: Omit<CapaEffectiveness, 'id'> = {
    capa_id: id,
    check_date: data.check_date,
    criteria: data.criteria,
    result: data.result,
    evidence: data.evidence,
    checked_by: actor.id,
    checked_by_name: actor.name,
    follow_up_required: data.result === 'Not Effective',
    follow_up_capa_id: null,
    remarks: data.remarks || '',
    created_at: timestamp,
    updated_at: timestamp,
  };

  const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness), eff);

  let newStatus = 'effectiveness_completed';
  if (data.result === 'Not Effective') {
    newStatus = 'qa_review';
  }

  await updateCapa(id, {
    effectiveness_check_date: data.check_date,
    effectiveness_criteria: data.criteria,
    effectiveness_result: data.result,
    capa_status: newStatus,
  }, actor, { workflow: true });

  await audit(actor, 'EFFECTIVENESS_UPDATE', id, null, eff);

  if (data.result === 'Not Effective') {
    await notify(
      'CAPA Not Effective',
      `CAPA ${capa.capa_number} failed effectiveness — extension or new CAPA required`,
      id,
      capa.created_by,
    );
  }

  return { id: ref.id, ...eff };
}

export async function submitApproval(
  id: string,
  data: { decision: 'approved' | 'rejected'; comments: string; e_signature: string },
  actor: CapaActor,
): Promise<CapaApproval> {
  const capa = await getCapaById(id);
  if (!capa) throw new Error('CAPA not found');

  const { assertInvestigationApprovedForCapaWorkflow } = await import('./capa-investigation-service');
  await assertInvestigationApprovedForCapaWorkflow(id);

  if (capa.effectiveness_check_required && capa.effectiveness_result === 'Pending') {
    throw new Error('Effectiveness check must be completed before approval');
  }

  const needsHeadQa = requiresHeadQaApproval(capa.priority, capa);
  const isHeadQa = ['head_qa', 'super_admin'].includes(actor.role);
  const approvalLevel = needsHeadQa && !isHeadQa ? 'qa_review' : needsHeadQa ? 'head_qa' : 'final';

  const timestamp = now();
  const approval: Omit<CapaApproval, 'id'> = {
    capa_id: id,
    approval_level: approvalLevel,
    approver_id: actor.id,
    approver_name: actor.name,
    approver_role: actor.role,
    decision: data.decision,
    comments: data.comments,
    e_signature: data.e_signature,
    signed_at: timestamp,
    created_at: timestamp,
  };

  const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.approvals), approval);

  let newStatus: string;
  if (data.decision === 'rejected') {
    newStatus = 'rejected';
  } else if (needsHeadQa && approvalLevel === 'qa_review') {
    newStatus = 'qa_review';
  } else {
    newStatus = 'approved';
  }

  await updateCapa(id, { capa_status: newStatus }, actor, { workflow: true });
  await audit(actor, data.decision === 'approved' ? 'APPROVE' : 'REJECT', id, null, approval);
  return { id: ref.id, ...approval };
}

export async function closeCapa(id: string, actor: CapaActor, qaRemarks?: string): Promise<CapaRecord> {
  const { closeCapaWithClosure } = await import('./capa-closure-service');
  return closeCapaWithClosure(id, { id: actor.id, name: actor.name, role: actor.role }, qaRemarks);
}

export async function createCapaFromDeviation(deviationId: string, actor: CapaActor) {
  const dSnap = await getDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.deviations, deviationId));
  if (!dSnap.exists()) throw new Error('Deviation not found');
  const d = dSnap.data();
  return createCapa({
    capa_date: now().split('T')[0],
    capa_source: 'Deviation',
    source_reference_number: d.deviation_number as string,
    department: (d.department as string) || 'QA',
    product_name: (d.product_name as string) || '',
    batch_number: (d.batch_number as string) || '',
    capa_title: `CAPA for ${d.deviation_number}`,
    problem_description: (d.description as string) || '',
    root_cause: (d.root_cause as string) || '',
    corrective_action: '',
    preventive_action: '',
    action_owner: actor.id,
    action_owner_name: actor.name,
    target_completion_date: (d.target_closure_date as string) || '',
    effectiveness_check_required: true,
    effectiveness_criteria: 'Verify deviation root cause addressed and no recurrence in 3 consecutive batches',
    priority: d.criticality === 'Critical' ? 'critical' : d.criticality === 'Major' ? 'high' : 'medium',
    qa_remarks: '',
  }, actor, { status: 'submitted', deviation_id: deviationId });
}

export async function createCapaFromOos(oosId: string, actor: CapaActor) {
  const oSnap = await getDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.oos, oosId));
  if (!oSnap.exists()) throw new Error('OOS not found');
  const o = oSnap.data();
  return createCapa({
    capa_date: now().split('T')[0],
    capa_source: 'OOS',
    source_reference_number: (o.oos_number as string) || '',
    department: 'QC',
    product_name: (o.product_name as string) || '',
    batch_number: (o.batch_number as string) || '',
    capa_title: `CAPA for ${o.oos_number}`,
    problem_description: `OOS for ${o.test_name || o.test_parameter}: ${o.obtained_result}`,
    root_cause: '',
    corrective_action: '',
    preventive_action: '',
    action_owner: actor.id,
    action_owner_name: actor.name,
    target_completion_date: (o.target_closure_date as string) || '',
    effectiveness_check_required: true,
    effectiveness_criteria: 'Confirm OOS root cause eliminated; next 3 batches meet specification',
    priority: 'high',
    qa_remarks: '',
  }, actor, { status: 'submitted', oos_id: oosId });
}

export async function getCapaActions(capaId: string): Promise<CapaAction[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), CAPA_COLLECTIONS.actions),
    where('capa_id', '==', capaId),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CapaAction));
}

export async function addCapaAction(capaId: string, input: Omit<CapaAction, 'id' | 'capa_id' | 'created_at' | 'updated_at'>, actor: CapaActor) {
  const timestamp = now();
  const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.actions), {
    ...input, capa_id: capaId, created_at: timestamp, updated_at: timestamp,
  });
  await audit(actor, 'ACTION_CREATE', capaId, null, input);
  return { id: ref.id, capa_id: capaId, ...input, created_at: timestamp, updated_at: timestamp } as CapaAction;
}

export async function getCapaEffectiveness(capaId: string): Promise<CapaEffectiveness | null> {
  const { getCapaEffectivenessReview } = await import('./capa-effectiveness-service');
  return getCapaEffectivenessReview(capaId);
}

export async function getCapaApprovals(capaId: string): Promise<CapaApproval[]> {
  const { getCapaApprovals: getApprovals } = await import('./capa-approval-service');
  return getApprovals(capaId);
}

export async function getCapaAttachments(capaId: string): Promise<CapaAttachment[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), CAPA_COLLECTIONS.attachments),
    where('capa_id', '==', capaId),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CapaAttachment));
}

export async function uploadCapaAttachment(
  capaId: string, file: File, actor: CapaActor,
): Promise<CapaAttachment> {
  const path = `capa/${capaId}/${Date.now()}_${file.name}`;
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  const timestamp = now();
  const attachment: Omit<CapaAttachment, 'id'> = {
    capa_id: capaId,
    file_name: file.name,
    file_url: url,
    file_type: file.type,
    uploaded_by: actor.id,
    uploaded_by_name: actor.name,
    uploaded_at: timestamp,
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.attachments), attachment);
  await audit(actor, 'ATTACHMENT_UPLOAD', capaId, null, { file_name: file.name });
  return { id: refDoc.id, ...attachment };
}

export async function getCapaSourceLinks(capaId: string): Promise<CapaSourceLink[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), CAPA_COLLECTIONS.sourceLinks),
    where('capa_id', '==', capaId),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CapaSourceLink));
}

export async function getAuditLogsForCapa(capaId: string) {
  const { getAuditLogsForCapa: fetchLogs } = await import('./capa-audit-trail-service');
  return fetchLogs(capaId);
}

export function computeDashboardMetrics(records: CapaRecord[]): CapaDashboardMetrics {
  return computeExtendedCapaDashboardMetrics(records);
}

export function exportCapasCsv(records: CapaRecord[]) {
  downloadCsv('capa-records.csv',
    ['CAPA Number', 'Title', 'Source', 'Department', 'Product', 'Batch', 'Status', 'Priority', 'Target Date', 'Owner'],
    records.map((r) => [
      r.capa_number, r.capa_title, r.capa_source, r.department, r.product_name,
      r.batch_number, r.capa_status, r.priority, r.target_completion_date || '', r.action_owner_name,
    ]),
  );
}

export function capaChartData(records: CapaRecord[]) {
  const byDept = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byStatus = new Map<string, number>();

  records.forEach((r) => {
    byDept.set(r.department, (byDept.get(r.department) || 0) + 1);
    bySource.set(r.capa_source, (bySource.get(r.capa_source) || 0) + 1);
    byStatus.set(r.capa_status, (byStatus.get(r.capa_status) || 0) + 1);
    const month = r.created_at?.slice(0, 7) || 'Unknown';
    if (r.capa_status === 'closed') {
      byMonth.set(month, (byMonth.get(month) || 0) + 1);
    }
  });

  return {
    byDepartment: Array.from(byDept.entries()).map(([name, value]) => ({ name, value })),
    bySource: Array.from(bySource.entries()).map(([name, value]) => ({ name, value })),
    byStatus: Array.from(byStatus.entries()).map(([name, value]) => ({ name, value })),
    monthlyClosure: Array.from(byMonth.entries()).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    effectiveness: [
      { name: 'Effective', value: records.filter((r) => r.effectiveness_result === 'Effective').length },
      { name: 'Not Effective', value: records.filter((r) => r.effectiveness_result === 'Not Effective').length },
      { name: 'Pending', value: records.filter((r) => r.effectiveness_result === 'Pending').length },
    ],
  };
}

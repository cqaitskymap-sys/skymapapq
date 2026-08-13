import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured } from '@/lib/firebase';
import { createAuditLog } from '@/lib/audit-trail';
import { logAuditEvent } from '@/lib/admin/admin-service';
import { downloadCsv } from '@/lib/export-utils';
import {
  computeExtendedDashboardMetrics,
  applyOverdueCheck,
} from '@/lib/deviation-dashboard-metrics';
import {
  DEVIATION_COLLECTIONS, type DeviationRecord, type DeviationInvestigation,
  type DeviationImpactAssessment, type DeviationApproval, type DeviationAttachment,
  type DeviationFilters, type DeviationDashboardMetrics, type DeviationActor,
  criticalityToLegacy, isOpenStatus, computeCapaRequired, requiresHeadQaApproval,
} from './deviation-types';

function now() { return new Date().toISOString(); }

async function audit(
  actor: DeviationActor,
  action: string,
  recordId: string,
  oldValue: unknown,
  newValue: unknown,
  reason = '',
  extra?: { fieldName?: string; documentNumber?: string; moduleName?: string },
) {
  await createAuditLog({
    moduleName: extra?.moduleName || 'Deviation Management',
    collectionName: DEVIATION_COLLECTIONS.deviations,
    recordId,
    documentNumber: extra?.documentNumber,
    actionType: action,
    actionDescription: reason || `${action.replace(/_/g, ' ')} on deviation`,
    fieldName: extra?.fieldName,
    oldValue,
    newValue,
    reason,
    user: { id: actor.id, name: actor.name, role: actor.role },
    status: 'Success',
  });
  try {
    await logAuditEvent({
      userId: actor.id,
      userName: actor.name,
      module: 'Deviation',
      recordId,
      action,
      oldValue: oldValue ? JSON.stringify(oldValue) : '',
      newValue: newValue ? JSON.stringify(newValue) : '',
      reason,
      ipAddress: typeof window !== 'undefined' ? 'client' : 'server',
      device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
      status: 'Success',
    });
  } catch {
    // legacy log optional
  }
}

async function notify(
  title: string,
  message: string,
  deviationId: string,
  userId: string,
) {
  try {
    await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.notifications), {
      title,
      message,
      module: 'Deviation',
      record_id: deviationId,
      user_id: userId,
      read: false,
      created_at: now(),
    });
  } catch (e) {
    console.error('Notification failed:', e);
  }
}

export async function generateDeviationNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `DEV-${year}-`;
  const q = query(
    collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations),
    where('deviation_number', '>=', prefix),
    where('deviation_number', '<=', `${prefix}\uf8ff`),
    orderBy('deviation_number', 'desc'),
    limit(1),
  );
  try {
    const snap = await getDocs(q);
    if (!snap.empty) {
      const last = snap.docs[0].data().deviation_number as string;
      const seq = parseInt(last.split('-').pop() || '0', 10) + 1;
      return `${prefix}${String(seq).padStart(4, '0')}`;
    }
  } catch {
    const all = await getDocs(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations));
    const count = all.size + 1;
    return `${prefix}${String(count).padStart(4, '0')}`;
  }
  return `${prefix}0001`;
}

async function linkBatchData(batchNumber: string): Promise<{ batch_id: string | null; pqr_id: string | null }> {
  if (!batchNumber) return { batch_id: null, pqr_id: null };
  try {
    const q = query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.batches),
      where('batch_number', '==', batchNumber),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return { batch_id: null, pqr_id: null };
    const data = snap.docs[0].data();
    return {
      batch_id: snap.docs[0].id,
      pqr_id: (data.pqr_id as string) || null,
    };
  } catch {
    return { batch_id: null, pqr_id: null };
  }
}

export async function createDeviation(
  input: Omit<Partial<DeviationRecord>, 'id' | 'deviation_number' | 'status' | 'created_at' | 'updated_at'> & {
    title: string; description: string; department: string; product_name: string;
    area: string; category: string; criticality: string; planned_type: string;
    immediate_action: string; reported_by_name: string; detected_by_name: string;
    deviation_date: string;
  },
  actor: DeviationActor,
  options?: { status?: string; source?: string; source_reference?: string; cpv_record_id?: string },
): Promise<DeviationRecord> {
  const deviationNumber = await generateDeviationNumber();
  const timestamp = now();
  const batchLink = await linkBatchData(input.batch_number || '');
  const capaRequired = computeCapaRequired(input as Partial<DeviationRecord>);

  const record: Omit<DeviationRecord, 'id'> = {
    deviation_number: deviationNumber,
    deviation_date: input.deviation_date,
    title: input.title,
    department: input.department,
    product_name: input.product_name,
    product_id: input.product_id || null,
    batch_number: input.batch_number || '',
    batch_id: batchLink.batch_id,
    area: input.area,
    reported_by: actor.id,
    reported_by_name: input.reported_by_name,
    detected_by: actor.id,
    detected_by_name: input.detected_by_name,
    category: input.category,
    planned_type: input.planned_type as DeviationRecord['planned_type'],
    criticality: input.criticality as DeviationRecord['criticality'],
    deviation_type: criticalityToLegacy(input.criticality as DeviationRecord['criticality']),
    description: input.description,
    immediate_action: input.immediate_action,
    batch_impacted: input.batch_impacted ?? false,
    product_quality_impacted: input.product_quality_impacted ?? false,
    patient_safety_impacted: input.patient_safety_impacted ?? false,
    regulatory_impact: input.regulatory_impact ?? false,
    repeat_deviation: input.repeat_deviation ?? false,
    capa_required: capaRequired,
    linked_capa_number: null,
    linked_capa_id: null,
    target_closure_date: input.target_closure_date || null,
    actual_closure_date: null,
    status: options?.status || 'draft',
    qa_remarks: input.qa_remarks || '',
    assigned_investigator: null,
    assigned_investigator_name: null,
    source: (options?.source as DeviationRecord['source']) || 'manual',
    source_reference: options?.source_reference || null,
    pqr_id: batchLink.pqr_id,
    cpv_record_id: options?.cpv_record_id || null,
    risk_assessment: input.criticality === 'Critical' ? 'critical'
      : input.criticality === 'Major' ? 'high' : 'medium',
    detected_date: input.deviation_date,
    root_cause: '',
    created_by: actor.id,
    created_by_name: actor.name,
    created_at: timestamp,
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: timestamp,
  };

  const ref = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations), record);
  await audit(actor, 'CREATE', ref.id, null, record);
  await notify('New Deviation Created', `${deviationNumber} — ${input.title}`, ref.id, actor.id);
  return { id: ref.id, ...record };
}

export async function createDeviationFromCpv(
  source: 'cpv_cpp' | 'cpv_cqa',
  cpvData: {
    id: string; product: string; batchNumber?: string; parameter: string;
    observedValue: number; status: string; department?: string;
  },
  actor: DeviationActor,
): Promise<DeviationRecord | null> {
  if (!['OOT', 'OOS'].includes(cpvData.status)) return null;
  const existing = await getDocs(query(
    collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations),
    where('cpv_record_id', '==', cpvData.id),
    limit(1),
  ));
  if (!existing.empty) return { id: existing.docs[0].id, ...existing.docs[0].data() } as DeviationRecord;

  return createDeviation({
    deviation_date: now().split('T')[0],
    department: cpvData.department || 'Production',
    product_name: cpvData.product,
    batch_number: cpvData.batchNumber || '',
    area: 'Manufacturing',
    reported_by_name: actor.name,
    detected_by_name: 'CPV System',
    category: source === 'cpv_cpp' ? 'Process' : 'Testing',
    planned_type: 'Unplanned',
    criticality: cpvData.status === 'OOS' ? 'Major' : 'Minor',
    title: `${source === 'cpv_cpp' ? 'CPP' : 'CQA'} Out of Limit — ${cpvData.parameter}`,
    description: `Auto-generated deviation from ${source === 'cpv_cpp' ? 'CPP' : 'CQA'} monitoring. Parameter: ${cpvData.parameter}. Observed value: ${cpvData.observedValue}. Status: ${cpvData.status}.`,
    immediate_action: 'CPV alert triggered. QA notified for investigation.',
    batch_impacted: Boolean(cpvData.batchNumber),
    product_quality_impacted: cpvData.status === 'OOS',
    patient_safety_impacted: false,
    regulatory_impact: cpvData.status === 'OOS',
    repeat_deviation: false,
    target_closure_date: null,
    qa_remarks: '',
  }, actor, { status: 'draft', source, source_reference: cpvData.id, cpv_record_id: cpvData.id });
}

export async function getDeviationById(id: string): Promise<DeviationRecord | null> {
  const snap = await getDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as DeviationRecord;
}

export async function listDeviations(filters?: DeviationFilters): Promise<DeviationRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations),
      orderBy('created_at', 'desc'),
      limit(1000),
    ));
    let results = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DeviationRecord));

  if (filters?.status) {
    results = results.filter((r) => r.status === filters.status);
  }
  if (filters?.department) {
    results = results.filter((r) => r.department === filters.department);
  }
  if (filters?.category) {
    results = results.filter((r) => r.category === filters.category);
  }
  if (filters?.criticality) {
    results = results.filter((r) => r.criticality === filters.criticality);
  }
  if (filters?.product_name) {
    const q = filters.product_name.toLowerCase();
    results = results.filter((r) => (r.product_name || '').toLowerCase().includes(q));
  }
  if (filters?.batch_number) {
    results = results.filter((r) => (r.batch_number || '').includes(filters.batch_number!));
  }
  if (filters?.deviation_number) {
    results = results.filter((r) => (r.deviation_number || '').includes(filters.deviation_number!));
  }
  if (filters?.capa_required !== undefined) {
    results = results.filter((r) => r.capa_required === filters.capa_required);
  }
  if (filters?.date_from) {
    results = results.filter((r) => r.deviation_date >= filters.date_from!);
  }
  if (filters?.date_to) {
    results = results.filter((r) => r.deviation_date <= filters.date_to!);
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    results = results.filter((r) =>
      (r.deviation_number || '').toLowerCase().includes(q) ||
      (r.title || '').toLowerCase().includes(q) ||
      (r.product_name || '').toLowerCase().includes(q) ||
      (r.batch_number || '').toLowerCase().includes(q),
    );
  }
  if (filters?.assigned_to) {
    const q = filters.assigned_to.toLowerCase();
    results = results.filter((r) => (r.assigned_investigator_name || '').toLowerCase().includes(q));
  }
  if (filters?.overdue_only) {
    results = results.filter((r) => {
      const checked = applyOverdueCheck(r);
      return checked.status === 'overdue';
    });
  }

  return results.map(applyOverdueCheck);
  } catch (e) {
    console.error('listDeviations', e);
    return [];
  }
}

export { applyOverdueCheck };

export async function updateDeviation(
  id: string,
  updates: Partial<DeviationRecord>,
  actor: DeviationActor,
  options?: { workflow?: boolean },
): Promise<DeviationRecord> {
  const existing = await getDeviationById(id);
  if (!existing) throw new Error('Deviation not found');
  const workflowFields = new Set([
    'status', 'root_cause', 'capa_required', 'actual_closure_date', 'deviation_type',
    'risk_assessment', 'assigned_investigator', 'assigned_investigator_name',
    'linked_capa_number', 'linked_capa_id', 'qa_remarks', 'target_closure_date',
    'updated_by', 'updated_by_name', 'updated_at',
  ]);
  if (!options?.workflow && existing.status !== 'draft') {
    const keys = Object.keys(updates).filter((k) => !workflowFields.has(k));
    if (keys.length > 0) {
      throw new Error('Only draft deviations can be fully edited');
    }
  }

  const timestamp = now();
  const payload: Partial<DeviationRecord> = {
    ...updates,
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: timestamp,
  };
  if (updates.criticality) {
    payload.deviation_type = criticalityToLegacy(updates.criticality as DeviationRecord['criticality']);
  }
  if (updates.product_quality_impacted !== undefined) {
    payload.capa_required = computeCapaRequired({ ...existing, ...updates });
  }

  await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations, id), payload);
  await audit(actor, 'UPDATE', id, existing, { ...existing, ...payload });
  return { ...existing, ...payload } as DeviationRecord;
}

export async function submitDeviation(id: string, actor: DeviationActor): Promise<DeviationRecord> {
  const existing = await getDeviationById(id);
  if (!existing) throw new Error('Deviation not found');
  if (existing.status !== 'draft') throw new Error('Only draft deviations can be submitted');

  const capaRequired = computeCapaRequired(existing);
  await updateDeviation(id, { capa_required: capaRequired }, actor, { workflow: true });

  const { initializeApprovalWorkflow } = await import('./deviation-approval-service');
  await initializeApprovalWorkflow(id, { id: actor.id, name: actor.name, role: actor.role });

  const r = await getDeviationById(id);
  if (!r) throw new Error('Deviation not found');
  await audit(actor, 'SUBMIT', id, existing, r);
  return r;
}

export async function assignInvestigator(
  id: string,
  investigatorName: string,
  actor: DeviationActor,
): Promise<DeviationRecord> {
  const updated = await updateDeviation(id, {
    assigned_investigator_name: investigatorName,
    assigned_investigator: actor.id,
    status: 'under_investigation',
  }, actor, { workflow: true });
  await audit(actor, 'ASSIGN_INVESTIGATOR', id, null, { investigatorName });
  return updated;
}

export async function saveInvestigation(
  deviationId: string,
  data: Omit<DeviationInvestigation, 'id' | 'deviation_id' | 'created_at' | 'updated_at'>,
  actor: DeviationActor,
): Promise<DeviationInvestigation> {
  const timestamp = now();
  const existing = await getInvestigation(deviationId);
  let result: DeviationInvestigation;

  if (existing) {
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations, existing.id), {
      ...data, updated_at: timestamp,
    });
    result = { ...existing, ...data, updated_at: timestamp };
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations), {
      deviation_id: deviationId, ...data, created_at: timestamp, updated_at: timestamp,
    });
    result = { id: ref.id, deviation_id: deviationId, ...data, created_at: timestamp, updated_at: timestamp };
  }

  await updateDeviation(deviationId, {
    root_cause: data.root_cause_details,
    status: 'under_investigation',
  }, actor, { workflow: true });
  await audit(actor, 'INVESTIGATION_UPDATE', deviationId, existing, result);
  return result;
}

export async function getInvestigation(deviationId: string): Promise<DeviationInvestigation | null> {
  const q = query(
    collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.investigations),
    where('deviation_id', '==', deviationId),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as DeviationInvestigation;
}

export async function saveImpactAssessment(
  deviationId: string,
  data: Omit<DeviationImpactAssessment, 'id' | 'deviation_id' | 'created_at' | 'updated_at'>,
  actor: DeviationActor,
): Promise<DeviationImpactAssessment> {
  const timestamp = now();
  const existing = await getImpactAssessment(deviationId);
  let result: DeviationImpactAssessment;

  if (existing) {
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.impactAssessments, existing.id), {
      ...data, updated_at: timestamp,
    });
    result = { ...existing, ...data, updated_at: timestamp };
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.impactAssessments), {
      deviation_id: deviationId, ...data, created_at: timestamp, updated_at: timestamp,
    });
    result = { id: ref.id, deviation_id: deviationId, ...data, created_at: timestamp, updated_at: timestamp };
  }

  const newStatus = data.capa_required ? 'capa_required' : 'qa_review';
  await updateDeviation(deviationId, { capa_required: data.capa_required, status: newStatus }, actor, { workflow: true });
  await audit(actor, 'IMPACT_ASSESSMENT', deviationId, existing, result);
  return result;
}

export async function getImpactAssessment(deviationId: string): Promise<DeviationImpactAssessment | null> {
  const q = query(
    collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.impactAssessments),
    where('deviation_id', '==', deviationId),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as DeviationImpactAssessment;
}

export async function linkCapa(
  deviationId: string,
  capaNumber: string,
  capaId: string | null,
  actor: DeviationActor,
): Promise<DeviationRecord> {
  const { linkExistingCapaToDeviation } = await import('./deviation-capa-service');
  const result = await linkExistingCapaToDeviation(deviationId, capaNumber, '', {
    id: actor.id, name: actor.name, role: actor.role,
  });
  if (result.error) throw new Error(result.error);
  const record = await getDeviationById(deviationId);
  if (!record) throw new Error('Deviation not found');
  return record;
}

export async function createCapaFromDeviation(
  deviationId: string,
  actor: DeviationActor,
): Promise<{ capaNumber: string; capaId: string }> {
  const record = await getDeviationById(deviationId);
  if (!record) throw new Error('Deviation not found');
  const { createCapaLinkFromDeviation, mapCapaLinkFormDefaults } = await import('./deviation-capa-service');
  const input = mapCapaLinkFormDefaults(record);
  const result = await createCapaLinkFromDeviation(deviationId, {
    ...input,
    root_cause: input.root_cause || record.root_cause || 'Pending investigation',
    corrective_action: input.corrective_action || 'To be defined',
    preventive_action: input.preventive_action || 'To be defined',
    responsible_person_name: input.responsible_person_name || actor.name,
  }, { id: actor.id, name: actor.name, role: actor.role });
  if (result.error || !result.capa) throw new Error(result.error || 'Failed to create CAPA');
  return { capaNumber: result.capa.capa_number, capaId: result.capa.id };
}

export async function submitApproval(
  deviationId: string,
  data: { decision: 'approved' | 'rejected'; comments: string; e_signature: string },
  actor: DeviationActor,
): Promise<DeviationApproval> {
  const { getCurrentPendingApproval } = await import('./deviation-approval-records');
  const {
    approveDeviationStep,
    rejectDeviationStep,
    getDeviationApprovals,
  } = await import('./deviation-approval-service');

  const approvals = await getDeviationApprovals(deviationId);
  const current = getCurrentPendingApproval(approvals);

  if (current) {
    const result = data.decision === 'rejected'
      ? await rejectDeviationStep(deviationId, current.id, data.comments, data.comments, { id: actor.id, name: actor.name, role: actor.role })
      : await approveDeviationStep(deviationId, current.id, data.comments, data.e_signature, { id: actor.id, name: actor.name, role: actor.role });
    if (result.error) throw new Error(result.error);
    return { ...current, decision: data.decision, comments: data.comments, e_signature: data.e_signature, signed_at: now() };
  }

  const deviation = await getDeviationById(deviationId);
  if (!deviation) throw new Error('Deviation not found');

  const needsHeadQa = requiresHeadQaApproval(deviation.criticality);
  const approvalLevel = needsHeadQa && actor.role !== 'head_qa' ? 'qa_review' : 'final';

  const timestamp = now();
  const approval: Omit<DeviationApproval, 'id'> = {
    deviation_id: deviationId,
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

  const ref = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvals), approval);

  let newStatus: string;
  if (data.decision === 'rejected') {
    newStatus = 'rejected';
  } else if (needsHeadQa && approvalLevel === 'qa_review') {
    newStatus = 'qa_review';
  } else {
    newStatus = 'approved';
  }

  await updateDeviation(deviationId, {
    status: newStatus,
    actual_closure_date: data.decision === 'approved' ? timestamp.split('T')[0] : null,
  }, actor, { workflow: true });

  await audit(actor, data.decision === 'approved' ? 'APPROVE' : 'REJECT', deviationId, null, approval);
  await notify(
    data.decision === 'approved' ? 'Deviation Approved' : 'Deviation Rejected',
    `${deviation.deviation_number} — ${data.decision}`,
    deviationId,
    actor.id,
  );

  return { id: ref.id, ...approval };
}

export async function closeDeviation(id: string, actor: DeviationActor): Promise<DeviationRecord> {
  const existing = await getDeviationById(id);
  if (!existing) throw new Error('Deviation not found');

  const { closeDeviationWithClosure, getDeviationClosure } = await import('./deviation-closure-service');
  const closureRecord = await getDeviationClosure(id);

  const result = await closeDeviationWithClosure(id, {
    investigation_completed: true,
    impact_assessment_completed: true,
    root_cause_identified: Boolean(existing.root_cause),
    capa_required: existing.capa_required,
    capa_linked: Boolean(existing.linked_capa_number),
    capa_completed: true,
    effectiveness_check_completed: true,
    product_quality_impact_resolved: !existing.product_quality_impacted,
    patient_safety_impact_resolved: !existing.patient_safety_impacted,
    regulatory_impact_resolved: !existing.regulatory_impact,
    all_attachments_reviewed: true,
    qa_closure_comments: closureRecord?.qa_closure_comments || existing.qa_remarks || 'Closed via deviation service',
    final_closure_conclusion: closureRecord?.final_closure_conclusion || 'Deviation closed per QA review.',
  }, actor.name, { id: actor.id, name: actor.name, role: actor.role });

  if (result.error) throw new Error(result.error);
  const updated = await getDeviationById(id);
  if (!updated) throw new Error('Deviation not found');
  return updated;
}

export async function getApprovals(deviationId: string): Promise<DeviationApproval[]> {
  const q = query(
    collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvals),
    where('deviation_id', '==', deviationId),
    orderBy('created_at', 'desc'),
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DeviationApproval));
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvals),
      where('deviation_id', '==', deviationId),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DeviationApproval));
  }
}

export async function uploadAttachment(
  deviationId: string,
  file: File,
  actor: DeviationActor,
): Promise<DeviationAttachment> {
  const path = `deviations/${deviationId}/${Date.now()}_${file.name}`;
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, file);
  const fileUrl = await getDownloadURL(storageRef);
  const timestamp = now();

  const attachment: Omit<DeviationAttachment, 'id'> = {
    deviation_id: deviationId,
    file_name: file.name,
    file_url: fileUrl,
    file_type: file.type,
    file_size: file.size,
    uploaded_by: actor.id,
    uploaded_by_name: actor.name,
    uploaded_at: timestamp,
  };

  const ref2 = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.attachments), attachment);
  await audit(actor, 'ATTACHMENT_UPLOAD', deviationId, null, { file_name: file.name });
  return { id: ref2.id, ...attachment };
}

export async function getAttachments(deviationId: string): Promise<DeviationAttachment[]> {
  const q = query(
    collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.attachments),
    where('deviation_id', '==', deviationId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DeviationAttachment));
}

export async function deleteAttachment(attachmentId: string, actor: DeviationActor): Promise<void> {
  const snap = await getDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.attachments, attachmentId));
  if (!snap.exists()) return;
  const data = snap.data() as DeviationAttachment;
  await deleteDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.attachments, attachmentId));
  await audit(actor, 'ATTACHMENT_DELETE', data.deviation_id, data, null);
}

export async function getAuditLogsForDeviation(deviationId: string) {
  const { getAuditLogsForDeviation: fetchLogs } = await import('@/lib/deviation-audit-trail-service');
  return fetchLogs(deviationId);
}

export function computeDashboardMetrics(records: DeviationRecord[]): DeviationDashboardMetrics {
  return computeExtendedDashboardMetrics(records);
}

export async function syncOverdueStatuses(): Promise<number> {
  const records = await listDeviations();
  const today = new Date().toISOString().split('T')[0];
  let count = 0;
  const batch = writeBatch(getFirebaseFirestore());

  for (const r of records) {
    if (r.target_closure_date && r.target_closure_date < today && isOpenStatus(r.status) && r.status !== 'overdue') {
      batch.update(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations, r.id), { status: 'overdue', updated_at: now() });
      count++;
    }
  }
  if (count > 0) await batch.commit();
  return count;
}

export function exportDeviationsCsv(records: DeviationRecord[]) {
  downloadCsv(
    `deviations_${new Date().toISOString().split('T')[0]}.csv`,
    ['Deviation No.', 'Date', 'Department', 'Product', 'Batch', 'Category', 'Criticality', 'Status', 'CAPA Required', 'Title'],
    records.map((r) => [
      r.deviation_number, r.deviation_date, r.department, r.product_name,
      r.batch_number, r.category, r.criticality, r.status, r.capa_required ? 'Yes' : 'No', r.title,
    ]),
  );
}

export function canUserAccessDeviation(
  action: 'view' | 'create' | 'investigate' | 'approve' | 'close',
  role: string,
  deviation?: DeviationRecord,
): boolean {
  const r = role.toLowerCase();
  if (['super_admin', 'admin'].includes(r)) return true;
  if (r === 'auditor' || r === 'viewer') return action === 'view';
  if (['head_qa', 'qa_manager', 'qa'].includes(r)) {
    return ['view', 'create', 'investigate', 'approve', 'close'].includes(action);
  }
  if (['qc_manager', 'qc', 'production_manager', 'production', 'engineering_manager', 'engineering', 'warehouse_manager', 'warehouse'].includes(r)) {
    if (action === 'view' || action === 'create') return true;
    if (action === 'investigate' && deviation) {
      const dept = r.replace('_manager', '').replace('_', ' ');
      return deviation.department.toLowerCase().includes(dept.split('_')[0]);
    }
    return false;
  }
  return action === 'view';
}

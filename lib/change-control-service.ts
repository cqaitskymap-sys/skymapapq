import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseFirestore, getFirebaseStorage } from '@/lib/firebase';
import { logAuditEvent } from '@/lib/admin/admin-service';
import { downloadCsv } from '@/lib/export-utils';
import {
  CC_COLLECTIONS, type ChangeControlRecord, type ChangeImpactAssessment,
  type ChangeRiskAssessment, type ChangeImplementationAction, type ChangeEffectivenessReview,
  type ChangeApproval, type ChangeAttachment, type CcFilters, type CcDashboardMetrics,
  type CcActor, isCcClosed, calculateRpn, rpnToLevel, requiresHeadQaApproval, requiresRegulatoryReview,
} from './change-control-types';
import type { ChangeCreateInput } from './change-control-schemas';
import { assertRecordMutable, localCalendarDate, omitUndefined } from './qms-record-guard';

function now() { return new Date().toISOString(); }

async function audit(actor: CcActor, action: string, recordId: string, oldValue: unknown, newValue: unknown, reason = '') {
  await logAuditEvent({
    userId: actor.id, userName: actor.name, module: 'Change Control', recordId, action,
    oldValue: oldValue ? JSON.stringify(oldValue) : '',
    newValue: newValue ? JSON.stringify(newValue) : '',
    reason, ipAddress: 'client', device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
    status: 'Success',
  });
}

async function notify(title: string, message: string, changeId: string, opts?: { userId?: string; targetRole?: string }) {
  try {
    await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.notifications), {
      title, message, module: 'Change Control', record_id: changeId,
      ...(opts?.userId ? { user_id: opts.userId } : {}),
      ...(opts?.targetRole ? { target_role: opts.targetRole } : {}),
      read: false, created_at: now(),
    });
  } catch (e) { console.error('Notification failed:', e); }
}

export async function generateChangeNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CC/${year}/`;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CC_COLLECTIONS.records),
      where('change_control_number', '>=', prefix),
      where('change_control_number', '<=', `${prefix}\uf8ff`),
      orderBy('change_control_number', 'desc'),
      limit(1),
    ));
    if (!snap.empty) {
      const last = snap.docs[0].data().change_control_number as string;
      const seq = parseInt(last.split('/').pop() || '0', 10) + 1;
      return `${prefix}${String(seq).padStart(4, '0')}`;
    }
  } catch {
    const all = await getDocs(collection(getFirebaseFirestore(), CC_COLLECTIONS.records));
    const yearCount = all.docs.filter((d) => String(d.data().change_control_number || '').startsWith(prefix)).length;
    return `${prefix}${String(yearCount + 1).padStart(4, '0')}`;
  }
  return `${prefix}0001`;
}

async function linkBatch(batchNumber: string) {
  if (!batchNumber) return { batch_id: null, pqr_id: null, cpv_id: null };
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CC_COLLECTIONS.batches),
      where('batch_number', '==', batchNumber),
      limit(1),
    ));
    if (snap.empty) return { batch_id: null, pqr_id: null, cpv_id: null };
    const data = snap.docs[0].data();
    return {
      batch_id: snap.docs[0].id,
      pqr_id: (data.pqr_id as string) || null,
      cpv_id: (data.cpv_id as string) || (data.cpp_id as string) || null,
    };
  } catch {
    return { batch_id: null, pqr_id: null, cpv_id: null };
  }
}

export async function createChangeControl(
  input: ChangeCreateInput,
  actor: CcActor,
): Promise<ChangeControlRecord> {
  const ccNumber = await generateChangeNumber();
  const timestamp = now();
  const batchLink = await linkBatch(input.batch_number || '');

  const record: Omit<ChangeControlRecord, 'id'> = {
    change_control_number: ccNumber,
    change_date: input.change_date,
    department: input.department,
    initiated_by: actor.id,
    initiated_by_name: input.initiated_by_name,
    product_name: input.product_name || '',
    batch_number: input.batch_number || '',
    change_title: input.change_title,
    change_description: input.change_description,
    current_system: input.current_system,
    proposed_change: input.proposed_change,
    reason_for_change: input.reason_for_change,
    change_type: input.change_type,
    change_category: input.change_category,
    change_priority: input.change_priority,
    temporary_permanent: input.temporary_permanent,
    planned_implementation_date: input.planned_implementation_date,
    target_closure_date: input.target_closure_date || null,
    actual_implementation_date: null,
    affected_documents: input.affected_documents || '',
    affected_equipment: input.affected_equipment || '',
    affected_material: input.affected_material || '',
    affected_vendor: input.affected_vendor || '',
    affected_process: input.affected_process || '',
    affected_product: input.affected_product || '',
    regulatory_impact: input.regulatory_impact,
    validation_impact: input.validation_impact,
    csv_impact: input.csv_impact,
    training_impact: input.training_impact,
    stability_impact: input.stability_impact,
    quality_impact: input.quality_impact,
    patient_safety_impact: input.patient_safety_impact,
    market_impact: input.market_impact,
    risk_assessment_required: input.risk_assessment_required,
    capa_required: input.capa_required,
    effectiveness_check_required: input.effectiveness_check_required,
    assigned_owner: input.assigned_owner,
    assigned_owner_name: input.assigned_owner_name || input.assigned_owner,
    qa_reviewer: input.qa_reviewer,
    qa_reviewer_name: input.qa_reviewer_name || input.qa_reviewer,
    remarks: input.remarks || '',
    qa_remarks: input.qa_remarks || input.remarks || '',
    status: 'draft',
    linked_capa_id: null,
    linked_capa_number: null,
    pqr_id: batchLink.pqr_id,
    batch_id: batchLink.batch_id,
    cpv_id: batchLink.cpv_id,
    created_by: actor.id,
    created_by_name: actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const refDoc = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.records), record);
  await audit(actor, 'CREATE', refDoc.id, null, record);
  return { id: refDoc.id, ...record };
}

export async function getChangeById(id: string): Promise<ChangeControlRecord | null> {
  const snap = await getDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.records, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as ChangeControlRecord;
}

export async function listChanges(filters?: CcFilters): Promise<ChangeControlRecord[]> {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CC_COLLECTIONS.records),
      orderBy('updated_at', 'desc'),
      limit(1000),
    ));
    let records = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChangeControlRecord));
    if (filters?.status && filters.status !== 'all') records = records.filter((r) => r.status === filters.status);
    if (filters?.change_type && filters.change_type !== 'all') records = records.filter((r) => r.change_type === filters.change_type);
    if (filters?.change_category && filters.change_category !== 'all') records = records.filter((r) => r.change_category === filters.change_category);
    if (filters?.department && filters.department !== 'all') records = records.filter((r) => r.department === filters.department);
    if (filters?.search) {
      const s = filters.search.toLowerCase();
      records = records.filter((r) =>
        r.change_control_number.toLowerCase().includes(s)
        || r.change_title.toLowerCase().includes(s)
        || r.product_name.toLowerCase().includes(s),
      );
    }
    return records;
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), CC_COLLECTIONS.records));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChangeControlRecord));
  }
}

export async function updateChange(
  id: string,
  patch: Partial<ChangeControlRecord>,
  actor: CcActor,
  workflow = false,
  options?: { reopen?: boolean },
): Promise<ChangeControlRecord> {
  const existing = await getChangeById(id);
  if (!existing) throw new Error('Change control not found');
  assertRecordMutable(existing.status, options, 'change control');
  if (!workflow && existing.status !== 'draft') throw new Error('Only draft records can be edited');
  const payload = omitUndefined({
    ...patch,
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: now(),
  } as Record<string, unknown>) as Partial<ChangeControlRecord>;
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.records, id), payload);
  await audit(actor, 'UPDATE', id, existing, { ...existing, ...payload });
  return { ...existing, ...payload } as ChangeControlRecord;
}

export async function syncOverdueChanges(): Promise<number> {
  const records = await listChanges();
  const today = localCalendarDate();
  let count = 0;
  for (const r of records) {
    if (isCcClosed(r.status) || r.status === 'overdue') continue;
    const due = r.target_closure_date || r.planned_implementation_date;
    if (due && due < today
      && !['implemented', 'effectiveness_completed', 'approved', 'closed'].includes(r.status)) {
      await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.records, r.id), { status: 'overdue', updated_at: now() });
      count++;
    }
  }
  return count;
}

export async function submitChange(id: string, actor: CcActor): Promise<ChangeControlRecord> {
  const cc = await getChangeById(id);
  if (!cc || cc.status !== 'draft') throw new Error('Only draft changes can be submitted');
  const updated = await updateChange(id, { status: 'submitted' }, actor, true);
  if (cc.qa_reviewer) {
    await notify('Change Control Submitted', `${cc.change_control_number} — ${cc.change_title} submitted for QA review.`, id, { userId: cc.qa_reviewer });
  } else {
    await notify('Change Control Submitted', `${cc.change_control_number} submitted for QA review.`, id, { targetRole: 'qa' });
  }
  if (cc.regulatory_impact) {
    await notify('Regulatory Review Required', `Change ${cc.change_control_number} requires Regulatory Affairs review.`, id, { targetRole: 'regulatory' });
  }
  if (cc.csv_impact) {
    await notify('CSV Review Required', `Change ${cc.change_control_number} requires IT/CSV team review.`, id, { targetRole: 'it_csv' });
  }
  if (requiresHeadQaApproval(cc.change_category)) {
    await notify('Head QA Approval Required', `Critical change ${cc.change_control_number} requires Head QA approval.`, id, { targetRole: 'head_qa' });
  }
  if (cc.validation_impact) {
    await notify('Validation Task Recommended', `Validation activities recommended for ${cc.change_control_number}.`, id, { userId: cc.assigned_owner || actor.id });
  }
  if (cc.training_impact) {
    await notify('Training Task Recommended', `Training plan recommended for ${cc.change_control_number}.`, id, { userId: cc.assigned_owner || actor.id });
  }
  await audit(actor, 'SUBMIT', id, cc, updated, 'Change control submitted');
  return updated;
}

export async function createAutoImplementationTasks(change: ChangeControlRecord, actor: CcActor) {
  const existing = await getImplementationActions(change.id);
  const existingTypes = new Set(existing.map((a) => a.action_type));
  const tasks: Array<{ action_item: string; action_type: ChangeImplementationAction['action_type'] }> = [];
  if (change.csv_impact && !existingTypes.has('csv')) {
    tasks.push({ action_item: 'CSV validation per change control scope', action_type: 'csv' });
  }
  if (change.validation_impact && !existingTypes.has('validation')) {
    tasks.push({ action_item: 'Validation activity per change scope', action_type: 'validation' });
  }
  if (change.training_impact && !existingTypes.has('training')) {
    tasks.push({ action_item: 'Training for affected personnel', action_type: 'training' });
  }
  const timestamp = now();
  for (const t of tasks) {
    await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.implementation), {
      change_id: change.id,
      action_item: t.action_item,
      responsible_person: actor.id,
      responsible_person_name: actor.name,
      target_date: change.planned_implementation_date,
      completion_date: null,
      status: 'pending',
      evidence: '',
      remarks: 'Auto-generated from change impact flags',
      action_type: t.action_type,
      created_at: timestamp,
      updated_at: timestamp,
    });
    await audit(actor, 'AUTO_TASK', change.id, null, t);
  }
}

export async function saveImpactAssessment(
  changeId: string, data: Omit<ChangeImpactAssessment, 'id' | 'change_id' | 'created_at' | 'updated_at' | 'assessed_by' | 'assessed_by_name' | 'assessed_at'>,
  actor: CcActor,
): Promise<ChangeImpactAssessment> {
  const timestamp = now();
  const existing = await getImpactAssessment(changeId);
  const payload = {
    change_id: changeId,
    ...data,
    assessed_by: actor.id,
    assessed_by_name: actor.name,
    assessed_at: timestamp,
    updated_at: timestamp,
  };

  let refId: string;
  if (existing) {
    await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.impact, existing.id), payload);
    refId = existing.id;
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.impact), { ...payload, created_at: timestamp });
    refId = ref.id;
  }

  const change = await updateChange(changeId, { status: 'impact_assessment' }, actor, true);
  await createAutoImplementationTasks(change, actor);
  await audit(actor, 'IMPACT_ASSESSMENT', changeId, null, payload);
  return { id: refId, ...payload, created_at: existing?.created_at || timestamp } as ChangeImpactAssessment;
}

export async function getImpactAssessment(changeId: string): Promise<ChangeImpactAssessment | null> {
  try {
    const { getLegacyImpactAssessment } = await import('@/lib/cc-impact-service');
    return await getLegacyImpactAssessment(changeId);
  } catch {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), CC_COLLECTIONS.impact), where('change_id', '==', changeId), limit(1)));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as ChangeImpactAssessment;
  }
}

export async function saveRiskAssessment(
  changeId: string,
  data: { severity: number; occurrence: number; detectability: number; mitigation_plan: string },
  actor: CcActor,
): Promise<ChangeRiskAssessment> {
  const rpn = calculateRpn(data.severity, data.occurrence, data.detectability);
  const risk_level = rpnToLevel(rpn);
  const timestamp = now();
  const existing = await getRiskAssessment(changeId);
  const payload = {
    change_id: changeId,
    ...data,
    rpn,
    risk_level,
    assessed_by: actor.id,
    assessed_by_name: actor.name,
    assessed_at: timestamp,
    updated_at: timestamp,
  };

  let refId: string;
  if (existing) {
    await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.risk, existing.id), payload);
    refId = existing.id;
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.risk), { ...payload, created_at: timestamp });
    refId = ref.id;
  }

  await updateChange(changeId, { status: 'risk_assessment' }, actor, true);
  await audit(actor, 'RISK_ASSESSMENT', changeId, null, payload);
  return { id: refId, ...payload, created_at: existing?.created_at || timestamp } as ChangeRiskAssessment;
}

export async function getRiskAssessment(changeId: string): Promise<ChangeRiskAssessment | null> {
  try {
    const { getLegacyRiskAssessment } = await import('@/lib/cc-risk-service');
    const legacy = await getLegacyRiskAssessment(changeId);
    if (legacy) return legacy;
  } catch {
    // fall through
  }
  const snap = await getDocs(query(collection(getFirebaseFirestore(), CC_COLLECTIONS.risk), where('change_id', '==', changeId), limit(1)));
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as ChangeRiskAssessment;
}

export async function addImplementationAction(
  changeId: string,
  input: Omit<ChangeImplementationAction, 'id' | 'change_id' | 'created_at' | 'updated_at'>,
  actor: CcActor,
): Promise<ChangeImplementationAction> {
  const timestamp = now();
  const ref = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.implementation), {
    change_id: changeId, ...input, created_at: timestamp, updated_at: timestamp,
  });
  await updateChange(changeId, { status: 'implementation_in_progress' }, actor, true);
  await audit(actor, 'IMPLEMENTATION_UPDATE', changeId, null, input);
  return { id: ref.id, change_id: changeId, ...input, created_at: timestamp, updated_at: timestamp };
}

export async function getImplementationActions(changeId: string): Promise<ChangeImplementationAction[]> {
  const snap = await getDocs(query(collection(getFirebaseFirestore(), CC_COLLECTIONS.implementation), where('change_id', '==', changeId)));
  const legacy = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChangeImplementationAction));
  if (legacy.length) return legacy;
  try {
    const { getCcImplementationTasks } = await import('@/lib/cc-implementation-service');
    const { mapCcImplementationTaskToLegacyAction } = await import('@/lib/cc-implementation-records');
    const tasks = await getCcImplementationTasks(changeId);
    return tasks.map((task) => mapCcImplementationTaskToLegacyAction(task) as ChangeImplementationAction);
  } catch {
    return legacy;
  }
}

export async function completeImplementationAction(
  actionId: string, changeId: string,
  data: { completion_date: string; evidence: string; status: string },
  actor: CcActor,
): Promise<void> {
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.implementation, actionId), { ...data, updated_at: now() });
  const actions = await getImplementationActions(changeId);
  const allDone = actions.every((a) => a.id === actionId ? data.status === 'completed' : a.status === 'completed');
  if (allDone) {
    const change = await getChangeById(changeId);
    await updateChange(changeId, {
      status: change?.effectiveness_check_required ? 'effectiveness_pending' : 'implemented',
      actual_implementation_date: data.completion_date,
    }, actor, true);
  }
}

export async function saveEffectivenessReview(
  changeId: string,
  data: Omit<ChangeEffectivenessReview, 'id' | 'change_id' | 'created_at' | 'updated_at' | 'reviewed_by' | 'reviewed_by_name'>,
  actor: CcActor,
): Promise<ChangeEffectivenessReview> {
  const timestamp = now();
  const payload = {
    change_id: changeId,
    ...data,
    reviewed_by: actor.id,
    reviewed_by_name: actor.name,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const existing = await getEffectivenessReview(changeId);
  let refId: string;
  if (existing) {
    await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness, existing.id), payload);
    refId = existing.id;
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness), payload);
    refId = ref.id;
  }
  await updateChange(changeId, { status: 'effectiveness_completed' }, actor, true);
  await audit(actor, 'EFFECTIVENESS_REVIEW', changeId, null, payload);
  return { id: refId, ...payload } as ChangeEffectivenessReview;
}

export async function getEffectivenessReview(changeId: string): Promise<ChangeEffectivenessReview | null> {
  const { getCcEffectivenessReview } = await import('@/lib/cc-effectiveness-service');
  return getCcEffectivenessReview(changeId);
}

export async function submitApproval(
  changeId: string,
  data: { decision: 'approved' | 'rejected'; comments: string; e_signature: string },
  actor: CcActor,
): Promise<ChangeApproval> {
  const change = await getChangeById(changeId);
  if (!change) throw new Error('Change not found');

  if (change.effectiveness_check_required) {
    const eff = await getEffectivenessReview(changeId);
    if (!eff && data.decision === 'approved' && change.status !== 'effectiveness_completed') {
      throw new Error('Effectiveness review must be completed before final approval');
    }
  }

  const needsHeadQa = requiresHeadQaApproval(change.change_category);
  const needsRegulatory = requiresRegulatoryReview(change);
  const isHeadQa = ['head_qa', 'super_admin'].includes(actor.role);
  const isRegulatory = ['regulatory_affairs', 'super_admin'].includes(actor.role);

  let approvalLevel: ChangeApproval['approval_level'] = 'qa_review';
  if (needsRegulatory && !isRegulatory && data.decision === 'approved') approvalLevel = 'regulatory';
  else if (needsHeadQa && !isHeadQa && data.decision === 'approved') approvalLevel = 'head_qa';
  else approvalLevel = 'final';

  const timestamp = now();
  const approval: Omit<ChangeApproval, 'id'> = {
    change_id: changeId,
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
  const ref = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.approvals), approval);

  let newStatus = data.decision === 'rejected' ? 'rejected' : 'approved';
  if (data.decision === 'approved' && approvalLevel !== 'final') {
    newStatus = approvalLevel === 'regulatory' ? 'under_qa_review' : 'final_qa_review';
  } else if (data.decision === 'approved' && approvalLevel === 'final') {
    newStatus = 'approved_for_implementation';
  }

  await updateChange(changeId, { status: newStatus }, actor, true);
  await audit(actor, data.decision === 'approved' ? 'APPROVE' : 'REJECT', changeId, null, approval);
  return { id: ref.id, ...approval };
}

export async function closeChange(changeId: string, actor: CcActor, qaRemarks?: string): Promise<ChangeControlRecord> {
  const change = await getChangeById(changeId);
  if (!change) throw new Error('Change not found');
  if (change.effectiveness_check_required) {
    const eff = await getEffectivenessReview(changeId);
    if (!eff || eff.result !== 'Effective') {
      throw new Error('Effectiveness review must be completed as Effective before closure');
    }
  }
  const updated = await updateChange(changeId, {
    status: 'closed',
    qa_remarks: qaRemarks || change.qa_remarks,
    actual_implementation_date: change.actual_implementation_date || now().split('T')[0],
  }, actor, true);
  await audit(actor, 'CLOSE', changeId, change, updated);
  if (change.pqr_id) {
    await notify('Change Control Closed', `CC ${change.change_control_number} closed and linked to PQR review`, changeId, { userId: change.created_by });
  }
  return updated;
}

export async function getApprovals(changeId: string): Promise<ChangeApproval[]> {
  const { getCcApprovals } = await import('@/lib/cc-approval-service');
  return getCcApprovals(changeId);
}

export async function getAttachments(changeId: string): Promise<ChangeAttachment[]> {
  const snap = await getDocs(query(collection(getFirebaseFirestore(), CC_COLLECTIONS.attachments), where('change_id', '==', changeId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChangeAttachment));
}

export async function uploadAttachment(changeId: string, file: File, actor: CcActor): Promise<ChangeAttachment> {
  const path = `change-control/${changeId}/${Date.now()}_${file.name}`;
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  const timestamp = now();
  const attachment: Omit<ChangeAttachment, 'id'> = {
    change_id: changeId, file_name: file.name, file_url: url, file_type: file.type,
    uploaded_by: actor.id, uploaded_by_name: actor.name, uploaded_at: timestamp,
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.attachments), attachment);
  await audit(actor, 'ATTACHMENT_UPLOAD', changeId, null, { file_name: file.name });
  return { id: refDoc.id, ...attachment };
}

export async function getAuditLogsForChange(changeId: string) {
  const { getAuditLogsForChange: fetchCcAuditLogs } = await import('@/lib/cc-audit-trail-service');
  return fetchCcAuditLogs(changeId);
}

export function computeDashboardMetrics(records: ChangeControlRecord[]): CcDashboardMetrics {
  return {
    total: records.length,
    open: records.filter((r) => !isCcClosed(r.status) && r.status !== 'rejected').length,
    closed: records.filter((r) => r.status === 'closed').length,
    overdue: records.filter((r) => r.status === 'overdue').length,
    critical: records.filter((r) => r.change_category === 'Critical').length,
    validationImpact: records.filter((r) => r.validation_impact).length,
    csvImpact: records.filter((r) => r.csv_impact).length,
    trainingPending: records.filter((r) => r.training_impact && !isCcClosed(r.status)).length,
    regulatoryImpact: records.filter((r) => r.regulatory_impact).length,
  };
}

export function ccChartData(
  records: ChangeControlRecord[],
  risks: ChangeRiskAssessment[] = [],
) {
  const byDept = new Map<string, number>();
  const byType = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byMonth = new Map<string, number>();
  let open = 0;
  let closed = 0;
  const riskLevels = new Map<string, number>();

  records.forEach((r) => {
    byDept.set(r.department, (byDept.get(r.department) || 0) + 1);
    byType.set(r.change_type, (byType.get(r.change_type) || 0) + 1);
    byCategory.set(r.change_category, (byCategory.get(r.change_category) || 0) + 1);
    const month = r.created_at?.slice(0, 7) || '';
    byMonth.set(month, (byMonth.get(month) || 0) + 1);
    if (isCcClosed(r.status)) closed++; else open++;
  });

  risks.forEach((r) => {
    riskLevels.set(r.risk_level, (riskLevels.get(r.risk_level) || 0) + 1);
  });

  return {
    byDepartment: Array.from(byDept.entries()).map(([name, value]) => ({ name, value })),
    byType: Array.from(byType.entries()).map(([name, value]) => ({ name, value })),
    byCategory: Array.from(byCategory.entries()).map(([name, value]) => ({ name, value })),
    monthlyTrend: Array.from(byMonth.entries()).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    openVsClosed: [{ name: 'Open', value: open }, { name: 'Closed', value: closed }],
    riskLevels: Array.from(riskLevels.entries()).map(([name, value]) => ({ name, value })),
  };
}

export async function listAllRiskAssessments(): Promise<ChangeRiskAssessment[]> {
  const snap = await getDocs(collection(getFirebaseFirestore(), CC_COLLECTIONS.risk));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChangeRiskAssessment));
}

export function exportChangesCsv(records: ChangeControlRecord[]) {
  downloadCsv('change-controls.csv',
    ['CC Number', 'Title', 'Type', 'Category', 'Department', 'Priority', 'Status', 'Planned Date'],
    records.map((r) => [
      r.change_control_number, r.change_title, r.change_type, r.change_category,
      r.department, r.change_priority, r.status, r.planned_implementation_date || '',
    ]),
  );
}

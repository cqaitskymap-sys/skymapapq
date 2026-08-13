import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured } from '@/lib/firebase';
import { logAuditEvent } from '@/lib/admin/admin-service';
import { generateDocumentNumber } from '@/lib/admin/document-numbering-service';
import { downloadCsv } from '@/lib/export-utils';
import { createCapa } from '@/lib/capa-service';
import {
  RECALL_COLLECTIONS, type RecallRecord, type RecallDistribution, type RecallRecovery,
  type RecallAttachment, type RecallFilters, type RecallDashboardMetrics,
  type RecallActor, isRecallClosed, requiresClassIApproval, calcRecoveryPercent,
} from './recall-types';
import { computeRecallDashboardMetrics, computeRecallChartData } from './recall-dashboard-records';
import type { RecallCreateInput, DistributionInput, RecoveryInput } from './recall-schemas';

function now() { return new Date().toISOString(); }

async function audit(actor: RecallActor, action: string, recordId: string, oldValue: unknown, newValue: unknown, reason = '') {
  await logAuditEvent({
    userId: actor.id, userName: actor.name, module: 'Recall', recordId, action,
    oldValue: oldValue ? JSON.stringify(oldValue) : '',
    newValue: newValue ? JSON.stringify(newValue) : '',
    reason, ipAddress: 'client', device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
    status: 'Success',
  });
}

async function notify(title: string, message: string, recordId: string, roles: string[]) {
  try {
    for (const role of roles) {
      await addDoc(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.notifications), {
        title, message, module: 'Recall', record_id: recordId, target_role: role,
        read: false, created_at: now(),
      });
    }
  } catch (e) { console.error('Notification failed:', e); }
}

export async function generateRecallNumber(): Promise<string> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured.');
  }
  try {
    const result = await generateDocumentNumber('REC', 'Product Recall', { increment: true });
    if (result.number) return result.number;
  } catch (e) {
    console.error('generateRecallNumber document numbering', e);
  }
  throw new Error('Unable to generate Recall number from backend configuration.');
}

async function linkBatch(batchNumber: string) {
  if (!batchNumber) return { batch_id: null, pqr_id: null };
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RECALL_COLLECTIONS.batches),
      where('batch_number', '==', batchNumber),
      limit(1),
    ));
    if (snap.empty) return { batch_id: null, pqr_id: null };
    const data = snap.docs[0].data();
    return { batch_id: snap.docs[0].id, pqr_id: (data.pqr_id as string) || null };
  } catch {
    return { batch_id: null, pqr_id: null };
  }
}

export async function createRecall(
  input: RecallCreateInput,
  actor: RecallActor,
  options?: { status?: string; fromComplaint?: boolean },
): Promise<RecallRecord> {
  const recallNumber = await generateRecallNumber();
  const timestamp = now();
  const batchLink = await linkBatch(input.batch_number);
  const recoveryPercent = calcRecoveryPercent(input.distributed_quantity, input.recovered_quantity);

  let linkedComplaintNumber: string | null = null;
  if (input.linked_complaint_id) {
    try {
      const cSnap = await getDoc(doc(getFirebaseFirestore(), RECALL_COLLECTIONS.complaints, input.linked_complaint_id));
      if (cSnap.exists()) linkedComplaintNumber = cSnap.data().complaint_number as string;
    } catch { /* optional */ }
  }

  const record: Omit<RecallRecord, 'id'> = {
    recall_number: recallNumber,
    recall_date: input.recall_date,
    recall_type: input.recall_type,
    recall_classification: input.recall_classification,
    recall_source: input.recall_source || 'Internal Quality Review',
    source_reference_number: input.source_reference_number || '',
    product_name: input.product_name,
    product_code: input.product_code || '',
    batch_number: input.batch_number,
    mfg_date: input.mfg_date || '',
    exp_date: input.exp_date || '',
    market_region: input.market_region,
    customer_name: input.customer_name || '',
    reason_for_recall: input.reason_for_recall,
    recall_justification: input.recall_justification || '',
    recall_initiated_by: actor.id,
    recall_initiated_by_name: input.recall_initiated_by_name,
    regulatory_notification_required: input.regulatory_notification_required,
    regulatory_authority: input.regulatory_authority || '',
    notification_due_date: input.notification_due_date || null,
    notification_status: input.regulatory_notification_required ? 'Pending' : 'Not Required',
    regulatory_notified: false,
    stock_quantity: input.stock_quantity,
    distributed_quantity: input.distributed_quantity,
    recovered_quantity: input.recovered_quantity,
    recovery_percent: recoveryPercent,
    impact_assessment: input.impact_assessment || '',
    risk_assessment: input.risk_assessment || '',
    capa_required: input.capa_required,
    linked_capa_id: input.linked_capa_id || null,
    linked_capa_number: input.linked_capa_number || null,
    linked_complaint_id: input.linked_complaint_id || null,
    linked_complaint_number: linkedComplaintNumber,
    linked_deviation_id: input.linked_deviation_id || null,
    linked_oos_id: input.linked_oos_id || null,
    assigned_owner: input.assigned_owner || null,
    assigned_owner_name: input.assigned_owner_name || input.recall_initiated_by_name,
    due_date: input.due_date || null,
    responsible_person: input.assigned_owner || null,
    responsible_person_name: input.assigned_owner_name || input.recall_initiated_by_name,
    include_in_pqr_review: input.include_in_pqr_review !== false,
    recall_status: options?.status || 'draft',
    qa_remarks: input.qa_remarks || '',
    batch_id: batchLink.batch_id,
    pqr_id: batchLink.pqr_id,
    head_qa_approved: false,
    regulatory_approved: false,
    created_by: actor.id,
    created_by_name: actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const refDoc = await addDoc(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.records), record);
  if (!options?.fromComplaint) {
    await audit(actor, 'CREATE', refDoc.id, null, record);
  }

  if (requiresClassIApproval(input.recall_classification)) {
    await notify('Class I Recall', `Class I recall ${recallNumber} — Head QA and Regulatory approval required`, refDoc.id, ['head_qa', 'regulatory_affairs', 'qa']);
  }

  return { id: refDoc.id, ...record };
}

export async function getRecallById(id: string): Promise<RecallRecord | null> {
  const snap = await getDoc(doc(getFirebaseFirestore(), RECALL_COLLECTIONS.records, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as RecallRecord;
}

export async function listRecalls(filters?: RecallFilters): Promise<RecallRecord[]> {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RECALL_COLLECTIONS.records),
      orderBy('updated_at', 'desc'),
      limit(1000),
    ));
    return applyFilters(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RecallRecord)), filters);
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.records));
    return applyFilters(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RecallRecord)), filters);
  }
}

function applyFilters(records: RecallRecord[], filters?: RecallFilters): RecallRecord[] {
  let r = records;
  if (filters?.recall_status && filters.recall_status !== 'all') r = r.filter((x) => x.recall_status === filters.recall_status);
  if (filters?.recall_type && filters.recall_type !== 'all') r = r.filter((x) => x.recall_type === filters.recall_type);
  if (filters?.recall_classification && filters.recall_classification !== 'all') r = r.filter((x) => x.recall_classification === filters.recall_classification);
  if (filters?.product) r = r.filter((x) => x.product_name.toLowerCase().includes(filters.product!.toLowerCase()));
  if (filters?.batch_number) r = r.filter((x) => x.batch_number.includes(filters.batch_number!));
  if (filters?.market_region) r = r.filter((x) => x.market_region.toLowerCase().includes(filters.market_region!.toLowerCase()));
  if (filters?.search) {
    const s = filters.search.toLowerCase();
    r = r.filter((x) => x.recall_number.toLowerCase().includes(s) || x.product_name.toLowerCase().includes(s));
  }
  return r;
}

export async function updateRecall(
  id: string, patch: Partial<RecallRecord>, actor: RecallActor, workflow = false,
): Promise<RecallRecord> {
  const existing = await getRecallById(id);
  if (!existing) throw new Error('Recall not found');
  if (!workflow && existing.recall_status !== 'draft') throw new Error('Only draft recalls can be edited');

  if (patch.distributed_quantity !== undefined || patch.recovered_quantity !== undefined) {
    const distributed = patch.distributed_quantity ?? existing.distributed_quantity;
    const recovered = patch.recovered_quantity ?? existing.recovered_quantity;
    patch.recovery_percent = calcRecoveryPercent(distributed, recovered);
  }

  const payload = { ...patch, updated_by: actor.id, updated_by_name: actor.name, updated_at: now() };
  await updateDoc(doc(getFirebaseFirestore(), RECALL_COLLECTIONS.records, id), payload);
  await audit(actor, 'UPDATE', id, existing, { ...existing, ...payload });
  return { ...existing, ...payload } as RecallRecord;
}

export async function initiateRecall(id: string, actor: RecallActor): Promise<RecallRecord> {
  const recall = await getRecallById(id);
  if (!recall || recall.recall_status !== 'draft') throw new Error('Only draft recalls can be initiated');
  return updateRecall(id, { recall_status: 'initiated' }, actor, true);
}

export async function addDistribution(recallId: string, input: DistributionInput, actor: RecallActor): Promise<RecallDistribution> {
  const { addRecallDistributionRecord } = await import('./recall-recovery-service');
  return addRecallDistributionRecord(recallId, input, actor);
}

export async function getDistributions(recallId: string): Promise<RecallDistribution[]> {
  const { getRecallDistributions } = await import('./recall-recovery-service');
  return getRecallDistributions(recallId);
}

export async function addRecovery(recallId: string, input: RecoveryInput, actor: RecallActor): Promise<RecallRecovery> {
  const { upsertRecallRecoveryRecord } = await import('./recall-recovery-service');
  const recall = await getRecallById(recallId);
  if (!recall) throw new Error('Recall not found');
  return upsertRecallRecoveryRecord(recallId, {
    customer_name: input.recovered_from,
    market_region: recall.market_region,
    distributed_quantity: Math.max(input.quantity_recovered, recall.distributed_quantity || 1),
    quantity_recovered: input.quantity_recovered,
    recovery_date: input.recovery_date,
    recovered_by_name: actor.name,
    recovery_status: input.recovery_status,
    reason_for_pending: '',
    follow_up_required: false,
    follow_up_date: null,
    remarks: input.remarks || '',
    distribution_id: null,
  }, actor);
}

export async function getRecoveries(recallId: string): Promise<RecallRecovery[]> {
  const { getRecallRecoveries } = await import('./recall-recovery-service');
  return getRecallRecoveries(recallId);
}

export async function submitRecallApproval(
  recallId: string,
  data: { approval_type: 'head_qa' | 'regulatory' | 'final'; decision: 'approved' | 'rejected'; comments: string; e_signature: string },
  actor: RecallActor,
): Promise<RecallRecord> {
  const recall = await getRecallById(recallId);
  if (!recall) throw new Error('Recall not found');

  const patch: Partial<RecallRecord> = {};
  if (data.approval_type === 'head_qa' && data.decision === 'approved') {
    patch.head_qa_approved = true;
  }
  if (data.approval_type === 'regulatory' && data.decision === 'approved') {
    patch.regulatory_approved = true;
    patch.regulatory_notified = true;
    patch.recall_status = 'regulatory_notified';
  }

  if (data.decision === 'rejected') {
    patch.recall_status = 'draft';
  } else if (requiresClassIApproval(recall.recall_classification)) {
    const headOk = data.approval_type === 'head_qa' ? true : recall.head_qa_approved;
    const regOk = data.approval_type === 'regulatory' ? true : recall.regulatory_approved;
    if (headOk && regOk) patch.recall_status = 'in_progress';
  } else if (data.approval_type === 'final') {
    patch.recall_status = 'closed';
  }

  await audit(actor, data.decision === 'approved' ? 'APPROVE' : 'REJECT', recallId, null, data);
  return updateRecall(recallId, patch, actor, true);
}

export async function closeRecall(recallId: string, actor: RecallActor): Promise<RecallRecord> {
  throw new Error('Use the Recall Closure module at /qms/recall/[id]/closure for GMP-compliant closure workflow');
}

async function createCapaFromRecall(recallId: string, actor: RecallActor) {
  const recall = await getRecallById(recallId);
  if (!recall) throw new Error('Recall not found');
  return createCapa({
    capa_date: now().split('T')[0],
    capa_source: 'Recall',
    source_reference_number: recall.recall_number,
    department: 'QA',
    product_name: recall.product_name,
    batch_number: recall.batch_number,
    capa_title: `CAPA from Recall ${recall.recall_number}`,
    problem_description: recall.reason_for_recall,
    root_cause: '',
    corrective_action: '',
    preventive_action: '',
    action_owner: actor.name,
    action_owner_name: actor.name,
    target_completion_date: new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
    effectiveness_check_required: true,
    effectiveness_criteria: 'Recall effectiveness verified — no further distribution of affected batch',
    priority: recall.recall_classification === 'Class I' ? 'critical' : 'high',
    qa_remarks: recall.qa_remarks,
  }, actor, { status: 'submitted' });
}

export async function getAttachments(recallId: string): Promise<RecallAttachment[]> {
  const snap = await getDocs(query(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.attachments), where('recall_id', '==', recallId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as RecallAttachment));
}

export async function uploadAttachment(recallId: string, file: File, actor: RecallActor): Promise<RecallAttachment> {
  const path = `recalls/${recallId}/${Date.now()}_${file.name}`;
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  const timestamp = now();
  const attachment: Omit<RecallAttachment, 'id'> = {
    recall_id: recallId, file_name: file.name, file_url: url, file_type: file.type,
    uploaded_by: actor.id, uploaded_by_name: actor.name, uploaded_at: timestamp,
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.attachments), attachment);
  await audit(actor, 'ATTACHMENT_UPLOAD', recallId, null, { file_name: file.name });
  return { id: refDoc.id, ...attachment };
}

export async function getAuditLogsForRecall(recallId: string) {
  const { getAuditLogsForRecall: fetchRecallAudit } = await import('@/lib/recall-audit-trail-service');
  return fetchRecallAudit(recallId);
}

export function computeDashboardMetrics(records: RecallRecord[]): RecallDashboardMetrics {
  return computeRecallDashboardMetrics(records);
}

export function recallChartData(records: RecallRecord[]) {
  const charts = computeRecallChartData(records);
  return {
    byProduct: charts.byProduct,
    byClassification: charts.byClassification,
    byMarket: charts.byMarket,
    recoveryTrend: charts.recoveryTrend.map((r) => ({ month: r.name, percent: r.avgPercent })),
  };
}

export function exportRecallsCsv(records: RecallRecord[]) {
  downloadCsv('recalls.csv',
    ['Number', 'Date', 'Product', 'Batch', 'Type', 'Classification', 'Status', 'Recovery %'],
    records.map((r) => [
      r.recall_number, r.recall_date, r.product_name, r.batch_number,
      r.recall_type, r.recall_classification, r.recall_status, String(r.recovery_percent),
    ]),
  );
}

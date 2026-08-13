import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { generateDocumentNumber } from '@/lib/admin/document-numbering-service';
import { getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured } from '@/lib/firebase';
import { logAuditEvent } from '@/lib/admin/admin-service';
import { downloadCsv } from '@/lib/export-utils';
import { createCapa } from '@/lib/capa-service';
import type { CapaRecord } from '@/lib/capa-types';
import {
  COMPLAINT_COLLECTIONS, type ComplaintRecord, type ComplaintInvestigation,
  type ComplaintAttachment, type ComplaintFilters, type ComplaintDashboardMetrics,
  type ComplaintActor, isComplaintClosed, isSafetyCategory,
} from './complaint-types';
import { computeComplaintDashboardMetrics } from './complaint-dashboard-records';
import type { ComplaintCreateInput } from './complaint-schemas';

function now() { return new Date().toISOString(); }

async function audit(actor: ComplaintActor, action: string, recordId: string, oldValue: unknown, newValue: unknown, reason = '') {
  await logAuditEvent({
    userId: actor.id, userName: actor.name, module: 'Complaint', recordId, action,
    oldValue: oldValue ? JSON.stringify(oldValue) : '',
    newValue: newValue ? JSON.stringify(newValue) : '',
    reason, ipAddress: 'client', device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
    status: 'Success',
  });
}

async function notify(title: string, message: string, recordId: string, roles: string[]) {
  try {
    for (const role of roles) {
      await addDoc(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.notifications), {
        title, message, module: 'Complaint', record_id: recordId, target_role: role,
        read: false, created_at: now(),
      });
    }
  } catch (e) { console.error('Notification failed:', e); }
}

export async function generateComplaintNumber(): Promise<string> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured.');
  }
  try {
    const result = await generateDocumentNumber('CMP', 'Market Complaint', { increment: true });
    if (result.number) return result.number;
  } catch (e) {
    console.error('generateComplaintNumber document numbering', e);
  }
  throw new Error('Unable to generate Complaint number from backend configuration.');
}

async function linkBatch(batchNumber: string) {
  if (!batchNumber) return { batch_id: null, pqr_id: null, cpv_product_id: null as string | null };
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.batches),
      where('batch_number', '==', batchNumber),
      limit(1),
    ));
    if (snap.empty) return { batch_id: null, pqr_id: null, cpv_product_id: null };
    const data = snap.docs[0].data();
    return {
      batch_id: snap.docs[0].id,
      pqr_id: (data.pqr_id as string) || null,
      cpv_product_id: String(data.cpv_product_id || data.cpvProductId || data.product_id || '') || null,
    };
  } catch {
    return { batch_id: null, pqr_id: null, cpv_product_id: null };
  }
}

function mapCreateInputToRecord(
  input: ComplaintCreateInput,
  complaintNumber: string,
  batchLink: Awaited<ReturnType<typeof linkBatch>>,
  actor: ComplaintActor,
  timestamp: string,
  status: string,
): Omit<ComplaintRecord, 'id'> {
  const safetyImpact = input.product_safety_impact || isSafetyCategory(input.complaint_category);
  const marketImpact = input.market_impact === true;
  const recallEval = marketImpact || input.recall_evaluation_required === true;

  return {
    complaint_number: complaintNumber,
    complaint_date: input.complaint_date,
    received_from: input.received_from,
    customer_name: input.customer_name,
    customer_type: input.customer_type || 'Retail',
    customer_contact: input.customer_contact || '',
    contact_person: input.contact_person || '',
    country: input.country || '',
    market_region: input.market_region,
    product_name: input.product_name,
    product_code: input.product_code || '',
    batch_number: input.batch_number || '',
    mfg_date: input.mfg_date || '',
    exp_date: input.exp_date || '',
    complaint_category: input.complaint_category,
    complaint_subcategory: input.complaint_subcategory || 'Other',
    complaint_description: input.complaint_description,
    issue_reported: input.issue_reported || '',
    quantity_involved: input.quantity_involved || '',
    sample_received: input.sample_received,
    photographs_available: input.photographs_available,
    retain_sample_required: input.retain_sample_required,
    complaint_criticality: input.complaint_criticality,
    initial_assessment: input.initial_assessment || '',
    investigation_required: input.investigation_required,
    product_safety_impact: safetyImpact,
    product_quality_impact: input.product_quality_impact,
    regulatory_impact: input.regulatory_impact,
    market_impact: marketImpact,
    recall_evaluation_required: recallEval,
    assigned_to: input.assigned_to || null,
    assigned_to_name: input.assigned_to_name || null,
    due_date: input.due_date || null,
    risk_level: input.risk_level || 'Low',
    capa_recommendation_required: input.product_quality_impact === true,
    head_qa_approval_required: input.complaint_criticality === 'Critical',
    root_cause: '',
    impact_assessment: '',
    capa_required: input.product_quality_impact === true,
    linked_capa_id: null,
    linked_capa_number: null,
    linked_recall_id: null,
    linked_recall_number: null,
    cpv_product_id: batchLink.cpv_product_id,
    closure_date: null,
    status,
    qa_remarks: input.qa_remarks || '',
    batch_id: batchLink.batch_id,
    pqr_id: batchLink.pqr_id,
    created_by: actor.id,
    created_by_name: actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export async function createComplaint(
  input: ComplaintCreateInput,
  actor: ComplaintActor,
  options?: { status?: string; submit?: boolean },
): Promise<ComplaintRecord> {
  const complaintNumber = await generateComplaintNumber();
  const timestamp = now();
  const batchLink = await linkBatch(input.batch_number || '');
  const status = options?.status || 'draft';

  const record = mapCreateInputToRecord(input, complaintNumber, batchLink, actor, timestamp, status);

  const refDoc = await addDoc(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.records), record);
  await audit(actor, 'CREATE', refDoc.id, null, record);

  if (input.complaint_criticality === 'Critical') {
    await notify('Critical Complaint', `Critical complaint ${complaintNumber} registered — immediate Head QA review required`, refDoc.id, ['head_qa', 'qa']);
  }
  if (input.product_safety_impact) {
    await notify('Patient Safety Complaint', `Complaint ${complaintNumber} reported patient safety impact`, refDoc.id, ['head_qa']);
  }
  if (input.regulatory_impact) {
    await notify('Regulatory Impact Complaint', `Complaint ${complaintNumber} has regulatory impact`, refDoc.id, ['regulatory_affairs']);
  }

  if (options?.submit && status === 'received') {
    const created = { id: refDoc.id, ...record } as ComplaintRecord;
    if (created.product_safety_impact || created.recall_evaluation_required) {
      await createRecallEvaluationTask(created, actor);
    }
    if (created.assigned_to) {
      await notify('Complaint Assigned', `Complaint ${complaintNumber} assigned for investigation`, refDoc.id, ['qa', 'qc']);
    }
  }

  return { id: refDoc.id, ...record };
}

export async function getComplaintById(id: string): Promise<ComplaintRecord | null> {
  const snap = await getDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.records, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as ComplaintRecord;
}

export async function listComplaints(filters?: ComplaintFilters): Promise<ComplaintRecord[]> {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.records),
      orderBy('updated_at', 'desc'),
      limit(1000),
    ));
    return applyFilters(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ComplaintRecord)), filters);
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.records));
    return applyFilters(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ComplaintRecord)), filters);
  }
}

function applyFilters(records: ComplaintRecord[], filters?: ComplaintFilters): ComplaintRecord[] {
  let r = records;
  if (filters?.status && filters.status !== 'all') r = r.filter((x) => x.status === filters.status);
  if (filters?.complaint_category && filters.complaint_category !== 'all') r = r.filter((x) => x.complaint_category === filters.complaint_category);
  if (filters?.complaint_criticality && filters.complaint_criticality !== 'all') r = r.filter((x) => x.complaint_criticality === filters.complaint_criticality);
  if (filters?.product) r = r.filter((x) => x.product_name.toLowerCase().includes(filters.product!.toLowerCase()));
  if (filters?.batch_number) r = r.filter((x) => x.batch_number.includes(filters.batch_number!));
  if (filters?.market_region) r = r.filter((x) => x.market_region.toLowerCase().includes(filters.market_region!.toLowerCase()));
  if (filters?.date_from) r = r.filter((x) => x.complaint_date >= filters.date_from!);
  if (filters?.date_to) r = r.filter((x) => x.complaint_date <= filters.date_to!);
  if (filters?.search) {
    const s = filters.search.toLowerCase();
    r = r.filter((x) =>
      x.complaint_number.toLowerCase().includes(s)
      || x.product_name.toLowerCase().includes(s)
      || x.customer_name.toLowerCase().includes(s),
    );
  }
  return r;
}

export async function updateComplaint(
  id: string, patch: Partial<ComplaintRecord>, actor: ComplaintActor, workflow = false,
): Promise<ComplaintRecord> {
  const existing = await getComplaintById(id);
  if (!existing) throw new Error('Complaint not found');
  if (!workflow && existing.status !== 'draft') throw new Error('Only draft complaints can be edited');
  const payload = { ...patch, updated_by: actor.id, updated_by_name: actor.name, updated_at: now() };
  await updateDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.records, id), payload);
  await audit(actor, 'UPDATE', id, existing, { ...existing, ...payload });
  return { ...existing, ...payload } as ComplaintRecord;
}

export async function submitComplaint(id: string, actor: ComplaintActor): Promise<ComplaintRecord> {
  const complaint = await getComplaintById(id);
  if (!complaint || complaint.status !== 'draft') throw new Error('Only draft complaints can be submitted');
  const updated = await updateComplaint(id, { status: 'received' }, actor, true);
  if (complaint.product_safety_impact || complaint.recall_evaluation_required) {
    await createRecallEvaluationTask(updated, actor);
  }
  if (updated.assigned_to) {
    await notify(
      'Complaint Assigned for Investigation',
      `Complaint ${updated.complaint_number} assigned to ${updated.assigned_to_name || 'investigator'}`,
      id,
      ['qa', 'qc'],
    );
  }
  return updated;
}

async function createRecallEvaluationTask(complaint: ComplaintRecord, actor: ComplaintActor) {
  const { createRecall } = await import('./recall-service');
  const due = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const recall = await createRecall({
    recall_date: now().split('T')[0],
    recall_type: 'Voluntary',
    recall_classification: complaint.complaint_criticality === 'Critical' ? 'Class I' : 'Class II',
    recall_source: 'Complaint',
    source_reference_number: complaint.complaint_number,
    product_name: complaint.product_name,
    product_code: complaint.product_code || '',
    batch_number: complaint.batch_number,
    mfg_date: complaint.mfg_date || '',
    exp_date: complaint.exp_date || '',
    market_region: complaint.market_region,
    customer_name: complaint.customer_name || '',
    reason_for_recall: `Recall evaluation from complaint ${complaint.complaint_number}: ${complaint.complaint_description.slice(0, 200)}`,
    recall_justification: '',
    recall_initiated_by_name: actor.name,
    regulatory_notification_required: complaint.complaint_criticality === 'Critical',
    regulatory_authority: complaint.complaint_criticality === 'Critical' ? 'CDSCO' : '',
    notification_due_date: null,
    stock_quantity: 0,
    distributed_quantity: 1,
    recovered_quantity: 0,
    impact_assessment: complaint.initial_assessment,
    risk_assessment: '',
    capa_required: false,
    linked_capa_id: null,
    linked_capa_number: '',
    linked_complaint_id: complaint.id,
    assigned_owner: actor.id,
    assigned_owner_name: actor.name,
    due_date: due,
    qa_remarks: 'Auto-generated recall evaluation task from product safety complaint',
    include_in_pqr_review: true,
  }, actor, { status: 'draft', fromComplaint: true });

  await updateDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.records, complaint.id), {
    linked_recall_id: recall.id,
    linked_recall_number: recall.recall_number,
    updated_at: now(),
  });
  await notify('Recall Evaluation Required', `Recall evaluation ${recall.recall_number} created from complaint ${complaint.complaint_number}`, complaint.id, ['qa', 'head_qa', 'regulatory_affairs']);
}

export async function saveInvestigation(
  complaintId: string, data: import('./complaint-schemas').ComplaintInvestigationInput, actor: ComplaintActor,
): Promise<ComplaintInvestigation> {
  const { saveInvestigation: saveInv } = await import('./complaint-investigation-service');
  return saveInv(complaintId, data, actor);
}

export async function getInvestigation(complaintId: string): Promise<ComplaintInvestigation | null> {
  const { getComplaintInvestigationRecord } = await import('./complaint-investigation-service');
  return getComplaintInvestigationRecord(complaintId);
}

export async function createCapaFromComplaint(complaintId: string, actor: ComplaintActor): Promise<CapaRecord> {
  const { createCapaFromComplaintLegacy } = await import('./complaint-capa-service');
  return createCapaFromComplaintLegacy(complaintId, actor);
}

export async function closeComplaint(id: string, actor: ComplaintActor, qaRemarks?: string): Promise<ComplaintRecord> {
  const { closeComplaintWithClosure } = await import('./complaint-closure-service');
  const { defaultComplaintClosureForm } = await import('./complaint-closure-records');
  const complaint = await getComplaintById(id);
  if (!complaint) throw new Error('Complaint not found');

  const {
    getActiveComplaintCapaLink,
  } = await import('./complaint-capa-service');
  const { getComplaintImpactAssessment } = await import('./complaint-impact-service');
  const { getComplaintInvestigationRecord } = await import('./complaint-investigation-service');
  const { getCapaById } = await import('@/lib/capa-service');
  const { getComplaintClosure } = await import('./complaint-closure-service');

  const [link, impact, investigation, attachments, closure] = await Promise.all([
    getActiveComplaintCapaLink(id),
    getComplaintImpactAssessment(id),
    getComplaintInvestigationRecord(id),
    getAttachments(id),
    getComplaintClosure(id),
  ]);
  let capa = null;
  if (link?.capa_id) capa = await getCapaById(link.capa_id);
  else if (complaint.linked_capa_id) capa = await getCapaById(complaint.linked_capa_id);

  const recallComplete = Boolean(complaint.linked_recall_id) || !complaint.recall_evaluation_required;
  const form = defaultComplaintClosureForm(complaint, investigation, impact, link, capa, attachments, recallComplete, closure);
  form.qa_closure_comments = qaRemarks || closure?.qa_closure_comments || complaint.qa_remarks || 'Closed via legacy action';
  form.final_complaint_conclusion = closure?.final_complaint_conclusion || form.final_complaint_conclusion || 'Complaint closed.';

  const result = await closeComplaintWithClosure(id, form, actor.name, actor);
  if (result.error) throw new Error(result.error);
  const updated = await getComplaintById(id);
  if (!updated) throw new Error('Complaint not found after closure');
  return updated;
}

export async function syncOverdueComplaints(): Promise<number> {
  const records = await listComplaints();
  const today = new Date().toISOString().split('T')[0];
  let count = 0;
  for (const r of records) {
    if (isComplaintClosed(r.status) || r.status === 'overdue') continue;
    const overdue = Boolean(r.due_date && r.due_date < today);
    if (overdue) {
      try {
        await updateDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.records, r.id), {
          status: 'overdue',
          updated_at: now(),
        });
        count++;
      } catch (e) {
        console.error('syncOverdueComplaints update', r.id, e);
      }
    }
  }
  return count;
}

export async function getAttachments(complaintId: string): Promise<ComplaintAttachment[]> {
  const snap = await getDocs(query(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.attachments), where('complaint_id', '==', complaintId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ComplaintAttachment));
}

export async function uploadAttachment(complaintId: string, file: File, actor: ComplaintActor): Promise<ComplaintAttachment> {
  const path = `complaints/${complaintId}/${Date.now()}_${file.name}`;
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  const timestamp = now();
  const attachment: Omit<ComplaintAttachment, 'id'> = {
    complaint_id: complaintId, file_name: file.name, file_url: url, file_type: file.type,
    uploaded_by: actor.id, uploaded_by_name: actor.name, uploaded_at: timestamp,
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.attachments), attachment);
  await audit(actor, 'ATTACHMENT_UPLOAD', complaintId, null, { file_name: file.name });
  return { id: refDoc.id, ...attachment };
}

export async function getAuditLogsForComplaint(complaintId: string) {
  const { getAuditLogsForComplaint: getLogs } = await import('@/lib/complaint-audit-trail-service');
  return getLogs(complaintId);
}

export function computeDashboardMetrics(records: ComplaintRecord[]): ComplaintDashboardMetrics {
  return computeComplaintDashboardMetrics(records);
}

export function complaintChartData(records: ComplaintRecord[]) {
  const byProduct = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byMarket = new Map<string, number>();

  records.forEach((r) => {
    byProduct.set(r.product_name, (byProduct.get(r.product_name) || 0) + 1);
    byCategory.set(r.complaint_category, (byCategory.get(r.complaint_category) || 0) + 1);
    byMonth.set(r.complaint_date.slice(0, 7), (byMonth.get(r.complaint_date.slice(0, 7)) || 0) + 1);
    byMarket.set(r.market_region, (byMarket.get(r.market_region) || 0) + 1);
  });

  return {
    byProduct: Array.from(byProduct.entries()).map(([name, value]) => ({ name, value })),
    byCategory: Array.from(byCategory.entries()).map(([name, value]) => ({ name, value })),
    monthlyTrend: Array.from(byMonth.entries()).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    byMarket: Array.from(byMarket.entries()).map(([name, value]) => ({ name, value })),
  };
}

export function exportComplaintsCsv(records: ComplaintRecord[]) {
  downloadCsv('complaints.csv',
    ['Number', 'Date', 'Product', 'Batch', 'Category', 'Criticality', 'Status', 'Customer'],
    records.map((r) => [
      r.complaint_number, r.complaint_date, r.product_name, r.batch_number,
      r.complaint_category, r.complaint_criticality, r.status, r.customer_name,
    ]),
  );
}

import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { generateDocumentNumber } from '@/lib/admin/document-numbering-service';
import { getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured } from '@/lib/firebase';
import {
  COMPLAINT_CREATE_MODULE,
  computeComplaintAutoRules,
  deriveRiskLevel,
  type ComplaintBatchOption,
  type ComplaintCreateActor,
  type ComplaintCustomerOption,
  type ComplaintInvestigatorOption,
  type ComplaintProductOption,
} from '@/lib/complaint-create-records';
import {
  createComplaint,
  submitComplaint,
  updateComplaint,
  uploadAttachment,
} from '@/lib/complaint-service';
import { COMPLAINT_COLLECTIONS, type ComplaintRecord } from '@/lib/complaint-types';
import type { ComplaintCreateInput } from '@/lib/complaint-schemas';

const nowIso = () => new Date().toISOString();

async function audit(actor: ComplaintCreateActor, actionType: string, recordId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: COMPLAINT_CREATE_MODULE,
      collectionName: COMPLAINT_COLLECTIONS.records,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('complaint create audit', e);
  }
}

async function notifyRoles(title: string, message: string, recordId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  try {
    for (const role of roles) {
      await addDoc(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.notifications), {
        title,
        message,
        module: 'Complaint',
        record_id: recordId,
        target_role: role,
        read: false,
        created_at: nowIso(),
      });
    }
  } catch (e) {
    console.error('complaint create notify', e);
  }
}

async function notifyInvestigator(complaint: ComplaintRecord) {
  if (!isFirebaseConfigured() || !complaint.assigned_to) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.notifications), {
      title: 'Complaint Assigned for Investigation',
      message: `Complaint ${complaint.complaint_number} — ${complaint.product_name} requires your investigation`,
      module: 'Complaint',
      record_id: complaint.id,
      user_id: complaint.assigned_to,
      target_role: 'qa',
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('notifyInvestigator', e);
  }
}

function applyAutoRulesToInput(input: ComplaintCreateInput): ComplaintCreateInput {
  const rules = computeComplaintAutoRules(input);
  return {
    ...input,
    recall_evaluation_required: rules.recall_evaluation_enabled ? true : input.recall_evaluation_required,
    risk_level: deriveRiskLevel(
      input.complaint_criticality,
      input.product_safety_impact,
      input.regulatory_impact,
    ),
  };
}

export async function previewComplaintNumber(): Promise<string> {
  if (!isFirebaseConfigured()) return '';
  try {
    const result = await generateDocumentNumber('CMP', 'Market Complaint', { increment: false });
    if (result.number) return result.number;
  } catch (e) {
    console.error('previewComplaintNumber document numbering', e);
  }
  return '';
}

export async function fetchComplaintCustomerOptions(): Promise<ComplaintCustomerOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.customers), limit(100)));
    const fromCustomers = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.customer_name || data.name || ''),
        customer_type: String(data.customer_type || data.type || ''),
        country: String(data.country || ''),
        market: String(data.market || data.market_region || ''),
        contact_person: String(data.contact_person || ''),
        contact_details: String(data.contact_details || data.phone || data.email || ''),
      };
    }).filter((c) => c.name);

    if (fromCustomers.length) return fromCustomers;

    const complaintSnap = await getDocs(query(
      collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.records),
      orderBy('updated_at', 'desc'),
      limit(200),
    ));
    const seen = new Set<string>();
    const fromComplaints: ComplaintCustomerOption[] = [];
    complaintSnap.docs.forEach((d) => {
      const data = d.data();
      const name = String(data.customer_name || '');
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      fromComplaints.push({
        id: d.id,
        name,
        customer_type: String(data.customer_type || ''),
        country: String(data.country || ''),
        market: String(data.market_region || ''),
        contact_person: String(data.contact_person || ''),
        contact_details: String(data.customer_contact || ''),
      });
    });
    return fromComplaints;
  } catch (e) {
    console.error('fetchComplaintCustomerOptions', e);
    return [];
  }
}

export async function fetchComplaintProductOptions(): Promise<ComplaintProductOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.products), limit(100)));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.product_name || data.name || data.productName || ''),
        code: String(data.product_code || data.code || data.productCode || ''),
      };
    }).filter((p) => p.name);
  } catch (e) {
    console.error('fetchComplaintProductOptions', e);
    return [];
  }
}

export async function fetchComplaintBatchOptions(productName?: string): Promise<ComplaintBatchOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.batches), limit(100)));
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          batch_number: String(data.batch_number || data.batchNumber || ''),
          product_name: String(data.product_name || data.productName || ''),
          mfg_date: String(data.mfg_date || data.manufacturing_date || data.manufacturingDate || ''),
          exp_date: String(data.exp_date || data.expiry_date || data.expiryDate || ''),
          pqr_id: (data.pqr_id as string) || null,
          cpv_product_id: String(data.cpv_product_id || data.cpvProductId || data.product_id || '') || null,
        };
      })
      .filter((b) => b.batch_number && (!productName || b.product_name === productName));
  } catch (e) {
    console.error('fetchComplaintBatchOptions', e);
    return [];
  }
}

export async function fetchComplaintInvestigatorOptions(): Promise<ComplaintInvestigatorOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.users), limit(80)));
    return snap.docs
      .reduce<ComplaintInvestigatorOption[]>((acc, d) => {
        const data = d.data();
        const role = String(data.role || '').toLowerCase();
        if (!['qa', 'qa_manager', 'qa_executive', 'qc', 'qc_manager', 'head_qa'].some((r) => role.includes(r))) {
          return acc;
        }
        acc.push({
          id: d.id,
          name: String(data.full_name || data.name || data.email || d.id),
          department: String(data.department || ''),
        });
        return acc;
      }, []);
  } catch (e) {
    console.error('fetchComplaintInvestigatorOptions', e);
    return [];
  }
}

export async function saveComplaintDraft(
  input: ComplaintCreateInput,
  actor: ComplaintCreateActor,
  draftId?: string | null,
): Promise<{ record?: ComplaintRecord; error?: string }> {
  try {
    const payload = applyAutoRulesToInput(input);
    const complaintActor = { id: actor.id, name: actor.name, role: actor.role || '' };
    if (draftId) {
      const record = await updateComplaint(draftId, mapInputToRecordPatch(payload), complaintActor, true);
      await audit(actor, 'Draft Saved', draftId, record.complaint_number);
      return { record };
    }
    const record = await createComplaint(payload, complaintActor, { status: 'draft' });
    await audit(actor, 'Draft Saved', record.id, record.complaint_number);
    return { record };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save draft' };
  }
}

export async function submitComplaintCreate(
  input: ComplaintCreateInput,
  actor: ComplaintCreateActor,
  draftId?: string | null,
): Promise<{ record?: ComplaintRecord; error?: string }> {
  try {
    const payload = applyAutoRulesToInput(input);
    const rules = computeComplaintAutoRules(payload);
    const complaintActor = { id: actor.id, name: actor.name, role: actor.role || '' };
    let record: ComplaintRecord;

    if (draftId) {
      await updateComplaint(draftId, mapInputToRecordPatch(payload), complaintActor, true);
      record = await submitComplaint(draftId, complaintActor);
    } else {
      record = await createComplaint(payload, complaintActor, { status: 'received', submit: true });
    }

    if (rules.notify_head_qa) {
      await notifyRoles(
        'Patient Safety / Critical Complaint',
        `Complaint ${record.complaint_number} requires Head QA attention`,
        record.id,
        ['head_qa', 'qa'],
      );
    }
    if (rules.notify_regulatory) {
      await notifyRoles(
        'Regulatory Impact Complaint',
        `Complaint ${record.complaint_number} has regulatory impact — review required`,
        record.id,
        ['regulatory_affairs', 'head_qa'],
      );
    }
    if (rules.head_qa_approval_required) {
      await notifyRoles(
        'Critical Complaint — Head QA Approval',
        `Complaint ${record.complaint_number} requires mandatory Head QA approval`,
        record.id,
        ['head_qa'],
      );
    }
    await notifyInvestigator(record);
    await audit(
      actor,
      'Submitted',
      record.id,
      `${record.complaint_number}${rules.head_qa_approval_required ? ' — Head QA approval required' : ''}`,
    );
    return { record };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to submit complaint' };
  }
}

export async function uploadComplaintCreateAttachment(
  complaintId: string,
  file: File,
  actor: ComplaintCreateActor,
): Promise<{ id: string; file_name: string; error?: string }> {
  if (complaintId === 'draft') {
    return { id: `pending-${Date.now()}`, file_name: file.name, error: 'Save draft first to upload attachments' };
  }
  try {
    const att = await uploadAttachment(complaintId, file, {
      id: actor.id,
      name: actor.name,
      role: actor.role || '',
    });
    await audit(actor, 'Attachment Uploaded', complaintId, att.file_name);
    return { id: att.id, file_name: att.file_name };
  } catch (e) {
    return { id: '', file_name: file.name, error: e instanceof Error ? e.message : 'Upload failed' };
  }
}

function mapInputToRecordPatch(input: ComplaintCreateInput): Partial<ComplaintRecord> {
  const rules = computeComplaintAutoRules(input);
  return {
    complaint_date: input.complaint_date,
    received_from: input.received_from,
    customer_name: input.customer_name,
    customer_type: input.customer_type,
    country: input.country,
    contact_person: input.contact_person,
    customer_contact: input.customer_contact,
    market_region: input.market_region,
    product_name: input.product_name,
    product_code: input.product_code,
    batch_number: input.batch_number,
    mfg_date: input.mfg_date,
    exp_date: input.exp_date,
    complaint_category: input.complaint_category,
    complaint_subcategory: input.complaint_subcategory,
    complaint_description: input.complaint_description,
    issue_reported: input.issue_reported,
    quantity_involved: input.quantity_involved,
    sample_received: input.sample_received,
    photographs_available: input.photographs_available,
    retain_sample_required: input.retain_sample_required,
    product_quality_impact: input.product_quality_impact,
    product_safety_impact: input.product_safety_impact,
    regulatory_impact: input.regulatory_impact,
    market_impact: input.market_impact,
    recall_evaluation_required: input.recall_evaluation_required,
    complaint_criticality: input.complaint_criticality,
    assigned_to: input.assigned_to,
    assigned_to_name: input.assigned_to_name,
    due_date: input.due_date,
    investigation_required: input.investigation_required,
    initial_assessment: input.initial_assessment,
    qa_remarks: input.qa_remarks,
    risk_level: input.risk_level || deriveRiskLevel(input.complaint_criticality, input.product_safety_impact, input.regulatory_impact),
    capa_recommendation_required: rules.capa_recommendation_required,
    head_qa_approval_required: rules.head_qa_approval_required,
    capa_required: rules.capa_recommendation_required,
  };
}

export { previewComplaintNumber as generateComplaintNumberPreview };

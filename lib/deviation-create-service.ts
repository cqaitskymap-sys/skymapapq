import {
  collection, doc, addDoc, getDocs, updateDoc, query, where, limit, orderBy,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { createAuditLog } from '@/lib/audit-trail';
import { generateDocumentNumber } from '@/lib/admin/document-numbering-service';
import {
  departmentCode,
  impactToBoolean,
  computeDeviationAutoRules,
  type DeviationBatchOption,
  type DeviationCreateActor,
  type DeviationProductOption,
} from '@/lib/deviation-create-records';
import type { DeviationCreateInput } from '@/lib/deviation-schemas';
import {
  DEVIATION_COLLECTIONS,
  criticalityToLegacy,
  computeCapaRequired,
  type DeviationAttachment,
  type DeviationRecord,
} from '@/lib/deviation-types';
import {
  getDeviationById,
  submitDeviation as submitDeviationRecord,
} from '@/lib/deviation-service';
import { getFirebaseFirestore, isFirebaseConfigured, getFirebaseStorage } from '@/lib/firebase';

const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));

async function safeQuery(name: string, max = 500): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), name), orderBy('createdAt', 'desc'), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), name), limit(max)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.error(`safeQuery ${name}`, e);
      return [];
    }
  }
}

export async function fetchDeviationProducts(): Promise<DeviationProductOption[]> {
  const rows = await safeQuery('products');
  const mapped = rows.map((r) => ({
    id: str(r.id),
    productName: str(r.productName || r.product_name || r.name),
    productCode: str(r.productCode || r.product_code || r.code),
    genericName: str(r.genericName || r.generic_name),
    market: str(r.market || r.marketName),
    dosageForm: str(r.dosageForm || r.dosage_form),
  })).filter((p) => p.productName);

  if (mapped.length) return mapped.sort((a, b) => a.productName.localeCompare(b.productName));

  const batches = await safeQuery('batches');
  const fromBatches = new Map<string, DeviationProductOption>();
  batches.forEach((b) => {
    const name = str(b.productName || b.product_name);
    if (!name) return;
    fromBatches.set(name, {
      id: str(b.productId || b.product_id || name),
      productName: name,
      productCode: str(b.productCode || b.product_code),
    });
  });
  return Array.from(fromBatches.values()).sort((a, b) => a.productName.localeCompare(b.productName));
}

export async function fetchDeviationBatches(productName?: string): Promise<DeviationBatchOption[]> {
  const names = ['batches', 'cpv_batches'];
  const merged: DeviationBatchOption[] = [];
  for (const col of names) {
    const rows = await safeQuery(col);
    rows.forEach((r) => {
      const pn = str(r.productName || r.product_name || r.product);
      if (productName && pn && pn !== productName) return;
      const batchNumber = str(r.batchNumber || r.batch_number || r.batchNo);
      if (!batchNumber) return;
      merged.push({
        id: str(r.id),
        batchNumber,
        productId: str(r.productId || r.product_id),
        productName: pn,
        productCode: str(r.productCode || r.product_code),
        manufacturingDate: str(r.manufacturingDate || r.manufacturing_date || r.mfgDate),
        expiryDate: str(r.expiryDate || r.expiry_date),
        pqrId: str(r.pqrId || r.pqr_id) || undefined,
        cpvBatchId: col === 'cpv_batches' ? str(r.id) : undefined,
      });
    });
  }
  const unique = new Map<string, DeviationBatchOption>();
  merged.forEach((b) => unique.set(b.batchNumber, b));
  return Array.from(unique.values()).sort((a, b) => b.batchNumber.localeCompare(a.batchNumber));
}

export async function validateBatchForProduct(batchNumber: string, productName: string): Promise<boolean> {
  if (!batchNumber) return true;
  const batches = await fetchDeviationBatches(productName);
  return batches.some((b) => b.batchNumber === batchNumber);
}

export async function generateDeviationNumberForDepartment(department: string): Promise<string> {
  const dept = departmentCode(department);
  const year = new Date().getFullYear();
  if (!isFirebaseConfigured()) return '';
  try {
    const result = await generateDocumentNumber('Deviation', 'GMP Deviation', {
      departmentCode: dept,
      date: new Date(),
      increment: true,
    });
    if (result.number) return result.number;
  } catch (e) {
    console.error('generateDocumentNumber fallback', e);
  }

  const prefix = `DEV/${dept}/${year}/`;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations),
      where('deviation_number', '>=', prefix),
      where('deviation_number', '<=', `${prefix}\uf8ff`),
      orderBy('deviation_number', 'desc'),
      limit(1),
    ));
    if (!snap.empty) {
      const last = str(snap.docs[0].data().deviation_number);
      const seq = parseInt(last.split('/').pop() || '0', 10) + 1;
      return `${prefix}${String(seq).padStart(4, '0')}`;
    }
  } catch (e) {
    console.error('generateDeviationNumberForDepartment', e);
  }
  return '';
}

async function linkBatchData(batchNumber: string, productName?: string): Promise<{
  batch_id: string | null;
  pqr_id: string | null;
  cpv_batch_id: string | null;
  product_code: string;
  manufacturing_date: string;
  expiry_date: string;
}> {
  if (!batchNumber) {
    return { batch_id: null, pqr_id: null, cpv_batch_id: null, product_code: '', manufacturing_date: '', expiry_date: '' };
  }
  const batches = await fetchDeviationBatches(productName);
  const match = batches.find((b) => b.batchNumber === batchNumber);
  if (!match) {
    return { batch_id: null, pqr_id: null, cpv_batch_id: null, product_code: '', manufacturing_date: '', expiry_date: '' };
  }
  return {
    batch_id: match.id,
    pqr_id: match.pqrId || null,
    cpv_batch_id: match.cpvBatchId || null,
    product_code: match.productCode || '',
    manufacturing_date: match.manufacturingDate || '',
    expiry_date: match.expiryDate || '',
  };
}

function mapInputToRecord(
  input: DeviationCreateInput,
  actor: DeviationCreateActor,
  deviationNumber: string,
  batchLink: Awaited<ReturnType<typeof linkBatchData>>,
  status: string,
): Omit<DeviationRecord, 'id'> {
  const ts = nowIso();
  const auto = computeDeviationAutoRules(input);
  const capaRequired = input.capa_required || auto.capaRequired;

  return {
    deviation_number: deviationNumber,
    deviation_date: input.deviation_date,
    deviation_time: input.deviation_time || '',
    title: input.title,
    department: input.department,
    product_name: input.product_name,
    product_id: input.product_id || null,
    product_code: input.product_code || batchLink.product_code,
    batch_number: input.batch_number || '',
    batch_id: batchLink.batch_id,
    cpv_batch_id: batchLink.cpv_batch_id,
    area: input.area,
    market: input.market || '',
    manufacturing_date: input.manufacturing_date || batchLink.manufacturing_date,
    expiry_date: input.expiry_date || batchLink.expiry_date,
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
    batch_impact: input.batch_impact,
    product_quality_impact: input.product_quality_impact,
    patient_safety_impact: input.patient_safety_impact,
    regulatory_impact_status: input.regulatory_impact_status,
    batch_impacted: impactToBoolean(input.batch_impact),
    product_quality_impacted: impactToBoolean(input.product_quality_impact),
    patient_safety_impacted: impactToBoolean(input.patient_safety_impact),
    regulatory_impact: impactToBoolean(input.regulatory_impact_status),
    repeat_deviation: input.repeat_deviation === 'Yes',
    previous_deviation_reference: input.previous_deviation_reference || '',
    investigation_required: input.investigation_required,
    capa_required: capaRequired,
    linked_capa_number: null,
    linked_capa_id: null,
    target_closure_date: input.target_closure_date,
    actual_closure_date: null,
    status,
    qa_remarks: input.qa_remarks || input.remarks || '',
    remarks: input.remarks || input.qa_remarks || '',
    assigned_investigator: null,
    assigned_investigator_name: input.assigned_investigator_name || null,
    qa_reviewer: null,
    qa_reviewer_name: input.qa_reviewer_name || null,
    head_qa_approval_required: auto.headQaApprovalRequired,
    source: (input.source as DeviationRecord['source']) || 'manual',
    source_reference: input.source_reference || null,
    pqr_id: batchLink.pqr_id,
    cpv_record_id: input.cpv_record_id || null,
    risk_assessment: input.criticality === 'Critical' ? 'critical'
      : input.criticality === 'Major' ? 'high' : 'medium',
    detected_date: input.deviation_date,
    root_cause: '',
    created_by: actor.id,
    created_by_name: actor.name,
    created_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: ts,
    is_deleted: false,
  };
}

async function saveQuickImpactAssessment(
  deviationId: string,
  input: DeviationCreateInput,
  actor: DeviationCreateActor,
) {
  try {
    await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.impactAssessments), {
      deviation_id: deviationId,
      impact_summary: `Batch: ${input.batch_impact}; Quality: ${input.product_quality_impact}; Safety: ${input.patient_safety_impact}; Regulatory: ${input.regulatory_impact_status}`,
      batch_impact_details: input.batch_impact,
      product_quality_impact_details: input.product_quality_impact,
      patient_safety_impact_details: input.patient_safety_impact,
      regulatory_impact_details: input.regulatory_impact_status,
      capa_required: input.capa_required,
      capa_justification: input.repeat_deviation === 'Yes' ? 'Repeat deviation' : '',
      assessed_by: actor.id,
      assessed_by_name: actor.name,
      assessed_at: nowIso(),
      created_at: nowIso(),
      updated_at: nowIso(),
      is_deleted: false,
    });
  } catch (e) {
    console.error('saveQuickImpactAssessment', e);
  }
}

async function createNotifications(
  deviationId: string,
  deviationNumber: string,
  input: DeviationCreateInput,
  actor: DeviationCreateActor,
) {
  const auto = computeDeviationAutoRules(input);
  const notifications = [
    { title: 'New Deviation Draft', message: `${deviationNumber} created by ${actor.name}`, user_id: actor.id },
    ...(input.assigned_investigator_name ? [{
      title: 'Deviation Assigned',
      message: `${deviationNumber} assigned for investigation`,
      user_id: 'qa_investigator',
    }] : []),
    ...(auto.notifyHeadQa ? [{
      title: 'Critical / Safety Deviation',
      message: `${deviationNumber} requires Head QA attention`,
      user_id: 'head_qa',
    }] : []),
    ...(auto.notifyRegulatory ? [{
      title: 'Regulatory Impact Deviation',
      message: `${deviationNumber} has regulatory impact`,
      user_id: 'regulatory_affairs',
    }] : []),
  ];

  for (const n of notifications) {
    try {
      await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.notifications), {
        ...n,
        module: 'Deviation',
        record_id: deviationId,
        read: false,
        created_at: nowIso(),
      });
    } catch (e) {
      console.error('createNotifications', e);
    }
  }
}

export async function logDeviationCreateAudit(
  actionType: string,
  actor: DeviationCreateActor,
  recordId: string,
  detail?: string,
): Promise<void> {
  try {
    await createAuditLog({
      moduleName: 'Deviation',
      collectionName: DEVIATION_COLLECTIONS.deviations,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
  } catch (e) {
    console.error('logDeviationCreateAudit', e);
  }
}

export async function saveDeviationDraft(
  input: DeviationCreateInput,
  actor: DeviationCreateActor,
  existingId?: string | null,
): Promise<{ record: DeviationRecord; error?: string }> {
  if (!isFirebaseConfigured()) {
    return { record: {} as DeviationRecord, error: 'Firebase is not configured.' };
  }

  try {
    if (input.batch_number && !(await validateBatchForProduct(input.batch_number, input.product_name))) {
      return { record: {} as DeviationRecord, error: 'Selected batch does not belong to the chosen product.' };
    }

    const batchLink = await linkBatchData(input.batch_number, input.product_name);

    if (existingId) {
      const existing = await getDeviationById(existingId);
      if (!existing) return { record: {} as DeviationRecord, error: 'Draft not found.' };
      if (existing.status !== 'draft') return { record: {} as DeviationRecord, error: 'Only draft deviations can be edited.' };

      const payload = mapInputToRecord(input, actor, existing.deviation_number, batchLink, 'draft');
      const { deviation_number: _n, created_at: _c, created_by: _cb, created_by_name: _cbn, ...updates } = payload;
      await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations, existingId), updates);
      await saveQuickImpactAssessment(existingId, input, actor);
      await logDeviationCreateAudit('Deviation Edited', actor, existingId, existing.deviation_number);
      return { record: { ...existing, ...updates, id: existingId } as DeviationRecord };
    }

    const deviationNumber = await generateDeviationNumberForDepartment(input.department);
    const record = mapInputToRecord(input, actor, deviationNumber, batchLink, 'draft');
    const docRef = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations), record);
    await saveQuickImpactAssessment(docRef.id, input, actor);
    await createNotifications(docRef.id, deviationNumber, input, actor);
    await logDeviationCreateAudit('Deviation Draft Created', actor, docRef.id, deviationNumber);
    await logDeviationCreateAudit('Deviation Number Generated', actor, docRef.id, deviationNumber);
    return { record: { id: docRef.id, ...record } };
  } catch (e) {
    console.error('saveDeviationDraft', e);
    return { record: {} as DeviationRecord, error: e instanceof Error ? e.message : 'Failed to save draft' };
  }
}

export async function submitDeviationFromCreate(
  deviationId: string,
  input: DeviationCreateInput,
  actor: DeviationCreateActor,
): Promise<{ record: DeviationRecord; error?: string }> {
  const draft = await saveDeviationDraft(input, actor, deviationId);
  if (draft.error) return draft;

  try {
    const submitted = await submitDeviationRecord(deviationId, {
      id: actor.id,
      name: actor.name,
      role: actor.role || 'qa',
    });
    await logDeviationCreateAudit('Deviation Submitted', actor, deviationId, submitted.deviation_number);
    await logDeviationCreateAudit('Workflow Assigned', actor, deviationId, submitted.status);

    if (input.investigation_required && input.assigned_investigator_name) {
      await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations, deviationId), {
        status: 'under_investigation',
        assigned_investigator_name: input.assigned_investigator_name,
        updated_at: nowIso(),
        updated_by: actor.id,
        updated_by_name: actor.name,
      });
    }

    return { record: submitted };
  } catch (e) {
    console.error('submitDeviationFromCreate', e);
    return { record: {} as DeviationRecord, error: e instanceof Error ? e.message : 'Failed to submit deviation' };
  }
}

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export async function uploadDeviationCreateAttachment(
  deviationId: string,
  file: File,
  actor: DeviationCreateActor,
): Promise<{ attachment?: DeviationAttachment; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (!ALLOWED_TYPES.includes(file.type) && !file.name.match(/\.(pdf|xlsx|xls|doc|docx|jpg|jpeg|png|webp)$/i)) {
    return { error: 'Unsupported file type. Allowed: PDF, Excel, Word, Images.' };
  }

  try {
    const path = `qms/deviation/${deviationId}/${Date.now()}_${file.name}`;
    const storageRef = ref(getFirebaseStorage(), path);
    await uploadBytes(storageRef, file);
    const fileUrl = await getDownloadURL(storageRef);
    const timestamp = nowIso();

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

    const docRef = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.attachments), {
      ...attachment,
      storage_path: path,
      created_at: timestamp,
      updated_at: timestamp,
      is_deleted: false,
    });

    await logDeviationCreateAudit('Attachment Uploaded', actor, deviationId, file.name);
    return { attachment: { id: docRef.id, ...attachment } };
  } catch (e) {
    console.error('uploadDeviationCreateAttachment', e);
    return { error: e instanceof Error ? e.message : 'Upload failed' };
  }
}

export async function deleteDeviationCreateAttachment(
  attachmentId: string,
  deviationId: string,
  actor: DeviationCreateActor,
  storagePath?: string,
): Promise<{ error?: string }> {
  try {
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.attachments, attachmentId), {
      is_deleted: true,
      updated_at: nowIso(),
      updated_by: actor.id,
    });
    if (storagePath) {
      try { await deleteObject(ref(getFirebaseStorage(), storagePath)); } catch { /* ignore */ }
    }
    await logDeviationCreateAudit('Attachment Deleted', actor, deviationId, attachmentId);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Delete failed' };
  }
}

export async function fetchDeviationAttachments(deviationId: string): Promise<DeviationAttachment[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.attachments),
      where('deviation_id', '==', deviationId),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as DeviationAttachment & { is_deleted?: boolean }))
      .filter((a) => !a.is_deleted);
  } catch (e) {
    console.error('fetchDeviationAttachments', e);
    return [];
  }
}
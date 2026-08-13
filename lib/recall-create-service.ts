import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { generateDocumentNumber } from '@/lib/admin/document-numbering-service';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  RECALL_CREATE_MODULE,
  computeRecallAutoRules,
  defaultNotificationDueDate,
  type RecallBatchOption,
  type RecallCapaOption,
  type RecallCreateActor,
  type RecallOwnerOption,
  type RecallProductOption,
  type RecallSourceOption,
} from '@/lib/recall-create-records';
import type { RecallCreateInput } from '@/lib/recall-schemas';
import {
  RECALL_COLLECTIONS,
  calcRecoveryPercent,
  requiresClassIApproval,
  type RecallRecord,
} from '@/lib/recall-types';
import {
  createRecall,
  getRecallById,
  initiateRecall,
  updateRecall,
} from '@/lib/recall-service';

const nowIso = () => new Date().toISOString();

async function audit(actor: RecallCreateActor, actionType: string, recordId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: RECALL_CREATE_MODULE,
      collectionName: RECALL_COLLECTIONS.records,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('recall create audit', e);
  }
}

async function notifyRoles(title: string, message: string, recordId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  try {
    for (const role of roles) {
      await addDoc(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.notifications), {
        title,
        message,
        module: 'Recall',
        record_id: recordId,
        target_role: role,
        read: false,
        created_at: nowIso(),
      });
    }
  } catch (e) {
    console.error('recall create notify', e);
  }
}

function mapInputToRecordPatch(input: RecallCreateInput): Partial<RecallRecord> {
  const recoveryPercent = calcRecoveryPercent(input.distributed_quantity, input.recovered_quantity);
  return {
    recall_date: input.recall_date,
    recall_type: input.recall_type,
    recall_classification: input.recall_classification,
    recall_source: input.recall_source,
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
    recall_initiated_by_name: input.recall_initiated_by_name,
    impact_assessment: input.impact_assessment || '',
    risk_assessment: input.risk_assessment || '',
    stock_quantity: input.stock_quantity,
    distributed_quantity: input.distributed_quantity,
    recovered_quantity: input.recovered_quantity,
    recovery_percent: recoveryPercent,
    regulatory_notification_required: input.regulatory_notification_required,
    regulatory_authority: input.regulatory_authority || '',
    notification_due_date: input.notification_due_date || (input.regulatory_notification_required ? defaultNotificationDueDate(input.recall_date) : null),
    notification_status: input.regulatory_notification_required ? 'Pending' : 'Not Required',
    capa_required: input.capa_required,
    linked_capa_id: input.linked_capa_id || null,
    linked_capa_number: input.linked_capa_number || null,
    linked_complaint_id: input.linked_complaint_id || null,
    linked_deviation_id: input.linked_deviation_id || null,
    linked_oos_id: input.linked_oos_id || null,
    assigned_owner: input.assigned_owner || null,
    assigned_owner_name: input.assigned_owner_name,
    due_date: input.due_date,
    responsible_person: input.assigned_owner || null,
    responsible_person_name: input.assigned_owner_name,
    qa_remarks: input.qa_remarks || '',
    include_in_pqr_review: input.include_in_pqr_review !== false,
  };
}

async function linkSourceReferences(input: RecallCreateInput): Promise<Partial<RecallRecord>> {
  const patch: Partial<RecallRecord> = {};
  const refId = input.source_reference_id;
  if (!refId) return patch;

  try {
    if (input.recall_source === 'Complaint') {
      const snap = await getDoc(doc(getFirebaseFirestore(), RECALL_COLLECTIONS.complaints, refId));
      if (snap.exists()) {
        const d = snap.data();
        patch.linked_complaint_id = refId;
        patch.linked_complaint_number = String(d.complaint_number || input.source_reference_number || '');
      }
    } else if (input.recall_source === 'Deviation') {
      const snap = await getDoc(doc(getFirebaseFirestore(), RECALL_COLLECTIONS.deviations, refId));
      if (snap.exists()) {
        patch.linked_deviation_id = refId;
        patch.source_reference_number = String(snap.data().deviation_number || input.source_reference_number || '');
      }
    } else if (input.recall_source === 'OOS') {
      const snap = await getDoc(doc(getFirebaseFirestore(), RECALL_COLLECTIONS.oosRecords, refId));
      if (snap.exists()) {
        patch.linked_oos_id = refId;
        patch.linked_oos_number = String(snap.data().oos_number || input.source_reference_number || '');
      }
    }
  } catch (e) {
    console.error('linkSourceReferences', e);
  }
  return patch;
}

export async function previewRecallNumber(): Promise<string> {
  if (!isFirebaseConfigured()) return '';
  try {
    const result = await generateDocumentNumber('REC', 'Product Recall', { increment: false });
    if (result.number) return result.number;
  } catch (e) {
    console.error('previewRecallNumber document numbering', e);
  }
  return '';
}

export async function fetchRecallProductOptions(): Promise<RecallProductOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.products), limit(100)));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.product_name || data.name || ''),
        code: String(data.product_code || data.code || ''),
      };
    }).filter((p) => p.name);
  } catch (e) {
    console.error('fetchRecallProductOptions', e);
    return [];
  }
}

export async function fetchRecallBatchOptions(productName?: string): Promise<RecallBatchOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.batches), limit(100)));
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          batch_number: String(data.batch_number || ''),
          product_name: String(data.product_name || ''),
          mfg_date: String(data.mfg_date || data.manufacturing_date || ''),
          exp_date: String(data.exp_date || data.expiry_date || ''),
          pqr_id: (data.pqr_id as string) || null,
        };
      })
      .filter((b) => b.batch_number && (!productName || b.product_name === productName));
  } catch (e) {
    console.error('fetchRecallBatchOptions', e);
    return [];
  }
}

export async function fetchRecallSourceOptions(source: string): Promise<RecallSourceOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    if (source === 'Complaint') {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.complaints), orderBy('updated_at', 'desc'), limit(50)));
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          number: String(data.complaint_number || d.id),
          label: `${data.complaint_number} — ${data.product_name}`,
          product_name: String(data.product_name || ''),
          batch_number: String(data.batch_number || ''),
          market_region: String(data.market_region || ''),
          reason: String(data.complaint_description || ''),
        };
      });
    }
    if (source === 'Deviation') {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.deviations), orderBy('updated_at', 'desc'), limit(50)));
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          number: String(data.deviation_number || d.id),
          label: `${data.deviation_number} — ${data.product_name || data.title || ''}`,
          product_name: String(data.product_name || ''),
          batch_number: String(data.batch_number || ''),
          market_region: String(data.market_region || data.department || ''),
          reason: String(data.description || data.deviation_description || ''),
        };
      });
    }
    if (source === 'OOS') {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.oosRecords), orderBy('updated_at', 'desc'), limit(50)));
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          number: String(data.oos_number || d.id),
          label: `${data.oos_number} — ${data.product_name || ''}`,
          product_name: String(data.product_name || ''),
          batch_number: String(data.batch_number || ''),
          market_region: String(data.market_region || data.department || ''),
          reason: String(data.description || data.oos_description || ''),
        };
      });
    }
  } catch (e) {
    console.error('fetchRecallSourceOptions', e);
  }
  return [];
}

export async function fetchRecallCapaOptions(): Promise<RecallCapaOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.capaRecords), orderBy('updated_at', 'desc'), limit(50)));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        capa_number: String(data.capa_number || d.id),
        title: String(data.capa_title || data.title || ''),
      };
    });
  } catch (e) {
    console.error('fetchRecallCapaOptions', e);
    return [];
  }
}

export async function fetchRecallOwnerOptions(): Promise<RecallOwnerOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), 'users'), limit(80)));
    return snap.docs.reduce<RecallOwnerOption[]>((acc, d) => {
      const data = d.data();
      const role = String(data.role || '').toLowerCase();
      if (!['qa', 'qa_manager', 'head_qa', 'warehouse', 'warehouse_manager', 'regulatory_affairs'].some((r) => role.includes(r))) {
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
    console.error('fetchRecallOwnerOptions', e);
    return [];
  }
}

async function enrichInput(input: RecallCreateInput): Promise<RecallCreateInput> {
  const sourcePatch = await linkSourceReferences(input);
  return {
    ...input,
    linked_complaint_id: sourcePatch.linked_complaint_id ?? input.linked_complaint_id,
    linked_deviation_id: sourcePatch.linked_deviation_id ?? input.linked_deviation_id,
    linked_oos_id: sourcePatch.linked_oos_id ?? input.linked_oos_id,
    source_reference_number: sourcePatch.source_reference_number || input.source_reference_number,
  };
}

export async function saveRecallDraft(
  input: RecallCreateInput,
  actor: RecallCreateActor,
  draftId?: string | null,
): Promise<{ record?: RecallRecord; error?: string }> {
  try {
    const recallActor = { id: actor.id, name: actor.name, role: actor.role || '' };
    const sourcePatch = await linkSourceReferences(input);
    const patch = { ...mapInputToRecordPatch(input), ...sourcePatch };

    if (draftId) {
      const record = await updateRecall(draftId, patch, recallActor, true);
      await audit(actor, 'Draft Saved', draftId, record.recall_number);
      return { record };
    }
    const enriched = await enrichInput(input);
    const record = await createRecall(enriched, recallActor, { status: 'draft' });
    await audit(actor, 'Draft Saved', record.id, record.recall_number);
    return { record };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save draft' };
  }
}

export async function initiateRecallCreate(
  input: RecallCreateInput,
  actor: RecallCreateActor,
  draftId?: string | null,
): Promise<{ record?: RecallRecord; error?: string }> {
  try {
    const rules = computeRecallAutoRules(input);
    const recallActor = { id: actor.id, name: actor.name, role: actor.role || '' };
    const sourcePatch = await linkSourceReferences(input);
    const patch = { ...mapInputToRecordPatch(input), ...sourcePatch };
    let record: RecallRecord;

    if (draftId) {
      await updateRecall(draftId, patch, recallActor, true);
      record = await initiateRecall(draftId, recallActor);
    } else {
      const enriched = await enrichInput(input);
      record = await createRecall(enriched, recallActor, { status: 'initiated' });
    }

    if (requiresClassIApproval(input.recall_classification) || rules.notify_head_qa) {
      await notifyRoles(
        'Class I Recall Initiated',
        `Recall ${record.recall_number} requires immediate Head QA and Regulatory attention`,
        record.id,
        ['head_qa', 'regulatory_affairs', 'qa'],
      );
    }
    if (rules.create_regulatory_task) {
      await notifyRoles(
        'Regulatory Notification Required',
        `Recall ${record.recall_number} — regulatory notification task created (due ${record.notification_due_date || 'ASAP'})`,
        record.id,
        ['regulatory_affairs', 'head_qa'],
      );
    }
    if (record.assigned_owner) {
      await addDoc(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.notifications), {
        title: 'Recall Assigned',
        message: `Recall ${record.recall_number} assigned to you for recovery tracking`,
        module: 'Recall',
        record_id: record.id,
        user_id: record.assigned_owner,
        target_role: 'qa',
        read: false,
        created_at: nowIso(),
      }).catch(() => undefined);
    }

    await audit(actor, 'Recall Initiated', record.id, `${record.recall_number} — PQR Recall Review: ${record.include_in_pqr_review !== false ? 'Yes' : 'No'}`);
    return { record };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to initiate recall' };
  }
}

export async function uploadRecallCreateAttachmentPlaceholder(
  recallId: string,
  fileName: string,
  actor: RecallCreateActor,
): Promise<void> {
  await audit(actor, 'Attachment Upload Blocked', recallId, fileName);
  throw new Error('Recall attachment upload backend is not implemented. Configure real file upload first.');
}

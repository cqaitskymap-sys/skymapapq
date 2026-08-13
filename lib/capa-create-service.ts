import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { generateDocumentNumber } from '@/lib/admin/document-numbering-service';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  CAPA_CREATE_MODULE,
  computeCapaAutoRules,
  getSourceLookupConfig,
  mapSourceRecordToPrefill,
  type CapaBatchOption,
  type CapaCreateActor,
  type CapaOwnerOption,
  type CapaProductOption,
  type CapaSourceLookupResult,
} from '@/lib/capa-create-records';
import { createCapa, submitCapa } from '@/lib/capa-service';
import { CAPA_COLLECTIONS, type CapaRecord } from '@/lib/capa-types';
import type { CapaCreateInput } from '@/lib/capa-schemas';

const nowIso = () => new Date().toISOString();

async function audit(actor: CapaCreateActor, actionType: string, recordId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: CAPA_CREATE_MODULE,
      collectionName: CAPA_COLLECTIONS.records,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('capa create audit', e);
  }
}

export async function previewCapaNumber(): Promise<string> {
  if (!isFirebaseConfigured()) {
    return '';
  }
  try {
    const result = await generateDocumentNumber('CAPA', 'Corrective Action', {
      departmentCode: 'QA',
      increment: false,
    });
    if (result.number) return result.number;
  } catch (e) {
    console.error('previewCapaNumber document numbering', e);
  }
  return '';
}

export async function lookupCapaSourceReference(
  source: string,
  referenceNumber: string,
): Promise<CapaSourceLookupResult> {
  if (!referenceNumber.trim()) return { found: false, message: 'Enter a reference number' };
  if (!isFirebaseConfigured()) {
    return { found: false, message: 'Firebase not configured' };
  }
  const config = getSourceLookupConfig(source);
  if (!config) return { found: false, message: 'Manual entry — no lookup for this source' };

  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), config.collection),
      where(config.field, '==', referenceNumber.trim()),
      limit(1),
    ));
    if (snap.empty) {
      return { found: false, message: `No ${source} record found for ${referenceNumber}` };
    }
    const docSnap = snap.docs[0];
    return mapSourceRecordToPrefill(source, docSnap.data() as Record<string, unknown>, docSnap.id);
  } catch (e) {
    console.error('lookupCapaSourceReference', e);
    return { found: false, message: 'Lookup failed — enter details manually' };
  }
}

export async function fetchCapaProductOptions(): Promise<CapaProductOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.products), limit(100)));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.product_name || data.name || data.productName || ''),
        code: String(data.product_code || data.code || ''),
      };
    }).filter((p) => p.name)
      .filter((p, i, arr) => arr.findIndex((x) => x.name === p.name) === i);
  } catch {
    return [];
  }
}

export async function fetchCapaBatchOptions(productName?: string): Promise<CapaBatchOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.batches), limit(100)));
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          batch_number: String(data.batch_number || data.batchNumber || ''),
          product_name: String(data.product_name || data.productName || ''),
        };
      })
      .filter((b) => b.batch_number && (!productName || b.product_name === productName))
      .filter((b, i, arr) => arr.findIndex((x) => x.batch_number === b.batch_number) === i);
  } catch {
    return [];
  }
}

export async function fetchCapaOwnerOptions(): Promise<CapaOwnerOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.users), limit(50)));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.full_name || data.name || data.email || d.id),
        department: String(data.department || ''),
      };
    });
  } catch {
    return [];
  }
}

async function linkSourceRecord(capa: CapaRecord, actor: CapaCreateActor) {
  if (!isFirebaseConfigured()) return;
  const timestamp = nowIso();
  try {
    if (capa.deviation_id) {
      await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.deviations, capa.deviation_id), {
        linked_capa_number: capa.capa_number,
        linked_capa_id: capa.id,
        capa_required: true,
        updated_at: timestamp,
      });
    }
    if (capa.oos_id) {
      await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.oos, capa.oos_id), {
        linked_capa_number: capa.capa_number,
        linked_capa_id: capa.id,
        capa_required: true,
        updated_at: timestamp,
      });
    }
    if (capa.complaint_id) {
      await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.complaints, capa.complaint_id), {
        linked_capa_number: capa.capa_number,
        linked_capa_id: capa.id,
        updated_at: timestamp,
      });
    }
    if (capa.audit_id) {
      await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.audits, capa.audit_id), {
        linked_capa_number: capa.capa_number,
        linked_capa_id: capa.id,
        updated_at: timestamp,
      });
    }
    if (capa.change_control_id) {
      await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.changeControls, capa.change_control_id), {
        linked_capa_number: capa.capa_number,
        linked_capa_id: capa.id,
        updated_at: timestamp,
      });
    }
    await audit(actor, 'Source Linked', capa.id, `${capa.capa_source} — ${capa.source_reference_number}`);
  } catch (e) {
    console.error('linkSourceRecord', e);
  }
}

async function notifyCapaOwner(capa: CapaRecord) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
      title: 'CAPA Assigned',
      message: `CAPA ${capa.capa_number} — ${capa.capa_title} requires your action`,
      module: 'CAPA',
      record_id: capa.id,
      user_id: capa.action_owner,
      target_role: 'qa',
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('notifyCapaOwner', e);
  }
}

export async function saveCapaDraft(
  input: CapaCreateInput,
  actor: CapaCreateActor,
): Promise<{ record?: CapaRecord; error?: string }> {
  try {
    const auto = computeCapaAutoRules(input.priority);
    const record = await createCapa({
      ...input,
      action_owner_name: input.action_owner_name || input.action_owner,
    }, { id: actor.id, name: actor.name, role: actor.role || '' }, {
      status: 'draft',
    });
    await audit(actor, 'Draft Saved', record.id, record.capa_number);
    return { record };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save draft' };
  }
}

export async function submitCapaCreate(
  input: CapaCreateInput,
  actor: CapaCreateActor,
  draftId?: string | null,
): Promise<{ record?: CapaRecord; error?: string }> {
  try {
    let record: CapaRecord;
  if (draftId) {
      const { updateCapa } = await import('@/lib/capa-service');
      const capaActor = { id: actor.id, name: actor.name, role: actor.role || '' };
      await updateCapa(draftId, {
        ...input,
        action_owner_name: input.action_owner_name || input.action_owner,
        effectiveness_check_date: input.effectiveness_check_date || null,
        criticality: computeCapaAutoRules(input.priority).criticality,
        head_qa_approval_required: computeCapaAutoRules(input.priority).head_qa_approval_required,
        qa_reviewer: input.qa_reviewer,
        qa_reviewer_name: input.qa_reviewer_name,
      } as Partial<CapaRecord>, capaActor);
      record = await submitCapa(draftId, capaActor);
    } else {
      record = await createCapa({
        ...input,
        action_owner_name: input.action_owner_name || input.action_owner,
      }, { id: actor.id, name: actor.name, role: actor.role || '' }, {
        status: 'submitted',
      });
    }
    await linkSourceRecord(record, actor);
    await notifyCapaOwner(record);
    await audit(actor, 'Submitted', record.id, `${record.capa_number}${record.head_qa_approval_required ? ' — Head QA approval required' : ''}`);
    if (record.head_qa_approval_required) {
      await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
        title: 'Critical CAPA — Head QA Review',
        message: `CAPA ${record.capa_number} requires Head QA approval`,
        module: 'CAPA',
        record_id: record.id,
        target_role: 'head_qa',
        read: false,
        created_at: nowIso(),
      }).catch(() => undefined);
    }
    return { record };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to submit CAPA' };
  }
}

export async function uploadCapaAttachmentPlaceholder(
  capaId: string,
  fileName: string,
  actor: CapaCreateActor,
): Promise<{ id: string; file_name: string }> {
  await audit(actor, 'Attachment Upload Blocked', capaId, fileName);
  throw new Error('CAPA attachment upload backend is not implemented. Configure real file upload first.');
}

export { previewCapaNumber as generateCapaNumberPreview };

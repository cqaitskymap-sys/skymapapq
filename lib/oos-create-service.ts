import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, limit, orderBy,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import {
  computeOosAutoRules,
  departmentCode,
  type OosBatchOption,
  type OosCreateActor,
  type OosInvestigatorOption,
  type OosProductOption,
  type OosSourcePrefill,
} from '@/lib/oos-create-records';
import type { OosCreateInput } from '@/lib/oos-schemas';
import {
  OOS_COLLECTIONS,
  buildLegacySpecification,
  computeResultStatus,
  isCriticalTest,
  type OosRecord,
} from '@/lib/oos-types';
import { createOosRecord, getOosById, submitOosWorkflow } from '@/lib/oos-service';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';

const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));
const num = (v: unknown, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

async function safeQuery(name: string, max = 500): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), name), orderBy('created_at', 'desc'), limit(max)));
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

export async function fetchOosProducts(): Promise<OosProductOption[]> {
  const rows = await safeQuery('products');
  const mapped = rows.map((r) => ({
    id: str(r.id),
    productName: str(r.productName || r.product_name || r.name),
    productCode: str(r.productCode || r.product_code || r.code),
  })).filter((p) => p.productName);

  if (mapped.length) return mapped.sort((a, b) => a.productName.localeCompare(b.productName));

  const batches = await safeQuery('batches');
  const fromBatches = new Map<string, OosProductOption>();
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

export async function fetchOosBatches(productName?: string): Promise<OosBatchOption[]> {
  const names = ['batches', 'cpv_batches'];
  const merged: OosBatchOption[] = [];
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
        pqrId: str(r.pqrId || r.pqr_id) || undefined,
      });
    });
  }
  const unique = new Map<string, OosBatchOption>();
  merged.forEach((b) => unique.set(b.batchNumber, b));
  return Array.from(unique.values()).sort((a, b) => b.batchNumber.localeCompare(a.batchNumber));
}

export async function fetchOosInvestigators(): Promise<OosInvestigatorOption[]> {
  const rows = await safeQuery('users');
  return rows
    .map((r) => ({
      id: str(r.id || r.uid),
      name: str(r.full_name || r.fullName || r.name || r.email),
      department: str(r.department),
      role: str(r.role),
    }))
    .filter((u) => u.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function generateOosNumberForDepartment(department: string): Promise<string> {
  const dept = departmentCode(department);
  const year = new Date().getFullYear();
  if (!isFirebaseConfigured()) return '';
  // Preview uses Firestore sequence locally. Calling generateAdminDocumentNumber here
  // only triggers browser CORS when the Cloud Function is not deployed (billing).
  const prefix = `OOS/${dept}/${year}/`;
  try {
    if (isFirebaseConfigured()) {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), OOS_COLLECTIONS.records),
        where('oos_number', '>=', prefix),
        where('oos_number', '<=', `${prefix}\uf8ff`),
        orderBy('oos_number', 'desc'),
        limit(1),
      ));
      if (!snap.empty) {
        const last = str(snap.docs[0].data().oos_number);
        const seq = parseInt(last.split('/').pop() || '0', 10) + 1;
        return `${prefix}${String(seq).padStart(4, '0')}`;
      }
    }
  } catch (e) {
    console.error('generateOosNumberForDepartment', e);
  }
  return '';
}

export async function fetchCqaPrefill(sourceId: string): Promise<OosSourcePrefill | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), 'cqa_results', sourceId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      source: 'cpv_cqa',
      sourceReference: sourceId,
      cpvRecordId: sourceId,
      cqaResultId: sourceId,
      productName: str(d.productName || d.product_name),
      batchNumber: str(d.batchNumber || d.batch_number),
      department: 'QC',
      testName: str(d.parameterName || d.parameter_name),
      parameterName: str(d.parameterName || d.parameter_name),
      stpNumber: str(d.stpNumber || d.stp_number),
      specificationNumber: str(d.specificationNumber || d.specification_number),
      specLowerLimit: num(d.lowerLimit ?? d.lower_limit),
      specUpperLimit: num(d.upperLimit ?? d.upper_limit),
      observedResult: num(d.observedResult ?? d.observed_result),
      unit: str(d.unit, '%'),
      analystName: str(d.analyst),
      sampleType: 'Finished Product',
      oosDate: str(d.testDate || d.test_date, nowIso().split('T')[0]),
    };
  } catch (e) {
    console.error('fetchCqaPrefill', e);
    return null;
  }
}

export async function fetchStabilityPrefill(sourceId: string): Promise<OosSourcePrefill | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), 'stability_results', sourceId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      source: 'cpv_cpp',
      sourceReference: sourceId,
      stabilityRecordId: sourceId,
      cpvRecordId: sourceId,
      productName: str(d.productName || d.product_name),
      batchNumber: str(d.batchNumber || d.batch_number),
      department: 'QC',
      testName: str(d.parameterName || d.parameter_name),
      parameterName: str(d.parameterName || d.parameter_name),
      stpNumber: str(d.stpNumber || d.stp_number),
      specificationNumber: str(d.specificationNumber || d.specification_number),
      specLowerLimit: num(d.lowerLimit ?? d.lower_limit ?? d.specLowerLimit),
      specUpperLimit: num(d.upperLimit ?? d.upper_limit ?? d.specUpperLimit),
      observedResult: num(d.observedResult ?? d.observed_result),
      unit: str(d.unit, '%'),
      analystName: str(d.analyst),
      sampleType: 'Stability',
      oosDate: str(d.testDate || d.test_date, nowIso().split('T')[0]),
    };
  } catch (e) {
    console.error('fetchStabilityPrefill', e);
    return null;
  }
}

export async function logOosCreateAudit(
  actionType: string,
  actor: OosCreateActor,
  recordId: string,
  detail?: string,
) {
  try {
    await createAuditLog({
      moduleName: 'OOS Create',
      collectionName: OOS_COLLECTIONS.records,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      user: { id: actor.id, name: actor.name, role: actor.role || '', department: '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('logOosCreateAudit', e);
  }
}

function mapInputToCreatePayload(input: OosCreateInput) {
  const auto = computeOosAutoRules(input);
  const resultStatus = computeResultStatus(
    input.observed_result,
    input.spec_lower_limit,
    input.spec_upper_limit,
  );
  const critical = input.is_critical_test ?? isCriticalTest(input.test_name);

  return {
    oos_date: input.oos_date,
    department: input.department,
    product_name: input.product_name,
    product_id: input.product_id || null,
    batch_number: input.batch_number || '',
    sample_type: input.sample_type,
    test_name: input.test_name,
    test_method: input.test_method,
    stp_number: input.stp_number,
    specification_number: input.specification_number,
    parameter_name: input.parameter_name,
    spec_lower_limit: input.spec_lower_limit,
    spec_upper_limit: input.spec_upper_limit,
    observed_result: input.observed_result,
    unit: input.unit,
    is_critical_test: critical,
    target_closure_date: input.target_closure_date,
    analyst_name: input.analyst_name,
    instrument_used: input.instrument_used,
    initial_observation: input.initial_observation,
    immediate_action: input.immediate_action,
    batch_release_blocked: input.batch_release_blocked ?? auto.batchBlocked,
    capa_required: input.capa_required ?? auto.capaSuggested,
    assigned_to: input.assigned_to || null,
    assigned_to_name: input.assigned_investigator_name,
    remarks: input.remarks || '',
    result_status_label: auto.resultStatus,
    result_status: resultStatus,
  };
}

export async function saveOosDraft(
  input: OosCreateInput,
  actor: OosCreateActor,
  draftId?: string | null,
): Promise<OosRecord> {
  const payload = mapInputToCreatePayload(input);

  if (draftId) {
    try {
      if (!isFirebaseConfigured()) throw new Error('Firebase not configured');
      const existing = await getOosById(draftId);
      if (existing && existing.status === 'draft') {
        const spec = buildLegacySpecification(payload.spec_lower_limit, payload.spec_upper_limit, payload.unit);
        await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.records, draftId), {
          ...payload,
          specification: spec,
          test_parameter: payload.parameter_name,
          obtained_result: String(payload.observed_result),
          status: 'draft',
          updated_by: actor.id,
          updated_by_name: actor.name,
          updated_at: nowIso(),
        });
        await logOosCreateAudit('draft saved', actor, draftId, existing.oos_number);
        const updated = await getOosById(draftId);
        return updated!;
      }
    } catch (e) {
      console.error('saveOosDraft update', e);
    }
  }

  const record = await createOosRecord(
    {
      oos_date: payload.oos_date,
      department: payload.department,
      product_name: payload.product_name,
      batch_number: payload.batch_number,
      test_name: payload.test_name,
      test_method: payload.test_method,
      stp_number: payload.stp_number,
      specification_number: payload.specification_number,
      parameter_name: payload.parameter_name,
      spec_lower_limit: payload.spec_lower_limit,
      spec_upper_limit: payload.spec_upper_limit,
      observed_result: payload.observed_result,
      unit: payload.unit,
      is_critical_test: payload.is_critical_test,
      target_closure_date: payload.target_closure_date,
      sample_type: payload.sample_type,
      analyst_name: payload.analyst_name,
      instrument_used: payload.instrument_used,
      initial_observation: payload.initial_observation,
      immediate_action: payload.immediate_action,
      batch_release_blocked: payload.batch_release_blocked,
      capa_required: payload.capa_required,
      assigned_to: payload.assigned_to,
      assigned_to_name: payload.assigned_to_name,
      remarks: payload.remarks,
      product_id: payload.product_id,
    },
    { id: actor.id, name: actor.name, role: actor.role || '' },
    {
      status: 'draft',
      source: input.source as OosRecord['source'],
      source_reference: input.source_reference || undefined,
      cpv_record_id: input.cpv_record_id || undefined,
      stability_record_id: input.stability_record_id || undefined,
      cqa_result_id: input.cqa_result_id || undefined,
    },
  );

  await logOosCreateAudit('draft created', actor, record.id, record.oos_number);
  return record;
}

export async function submitOosFromCreate(
  input: OosCreateInput,
  actor: OosCreateActor,
  draftId?: string | null,
): Promise<OosRecord> {
  const auto = computeOosAutoRules(input);
  const record = await saveOosDraft(input, actor, draftId);
  const submitted = await submitOosWorkflow(record.id, { id: actor.id, name: actor.name, role: actor.role || '' });
  await logOosCreateAudit('OOS submitted', actor, record.id, `${record.oos_number} — ${auto.resultStatus}`);
  return submitted || record;
}

export async function uploadOosCreateAttachmentPlaceholder(
  oosId: string,
  fileName: string,
  actor: OosCreateActor,
): Promise<{ id: string; file_name: string }> {
  await logOosCreateAudit('attachment upload blocked', actor, oosId, fileName);
  throw new Error('OOS attachment upload backend is not implemented. Configure real file upload first.');
}

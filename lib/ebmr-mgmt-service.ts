import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where,
  type DocumentData, type QueryConstraint, type UpdateData,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseFirestore, getFirebaseStorage } from '@/lib/firebase';
import { logAuditEvent } from '@/lib/admin/admin-service';
import { createDeviation } from '@/lib/deviation-service';
import { createOosRecord } from '@/lib/oos-service';
import { getEquipmentById, isEquipmentSelectable } from '@/lib/equipment-mgmt-service';
import { downloadCsv } from '@/lib/export-utils';
import {
  EBMR_COLLECTIONS, classifyCppValue, isEbmrEditable, OOS_IPC_CHECKS,
  type EbmrRecord, type LineClearanceRecord, type EbmrDispensingRecord,
  type ManufacturingStepRecord, type EquipmentUsageRecord, type CppRecord,
  type IpcCheckRecord, type EbmrReviewRecord, type EbmrReleaseRecord,
  type EbmrAttachment, type EbmrFilters, type EbmrDashboardMetrics, type EbmrActor,
} from './ebmr-mgmt-types';
import type {
  EbmrCreateInput, LineClearanceInput, EbmrDispensingInput, ManufacturingStepInput,
  EquipmentUsageInput, CppRecordInput, IpcCheckInput, EbmrReviewInput, EbmrReleaseInput,
} from './ebmr-mgmt-schemas';

function now() { return new Date().toISOString(); }
function today() { return now().split('T')[0]; }

async function auditLog(actor: EbmrActor, action: string, recordId: string, oldValue: unknown, newValue: unknown, reason = '') {
  await logAuditEvent({
    userId: actor.id, userName: actor.name, module: 'eBMR', recordId, action,
    oldValue: oldValue ? JSON.stringify(oldValue) : '',
    newValue: newValue ? JSON.stringify(newValue) : '',
    reason, ipAddress: 'client', device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
    status: 'Success',
  });
}

async function notify(title: string, message: string, recordId: string, roles: string[]) {
  try {
    for (const role of roles) {
      await addDoc(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.notifications), {
        title, message, module: 'eBMR', record_id: recordId, target_role: role, read: false, created_at: now(),
      });
    }
  } catch (e) { console.error('Notification failed:', e); }
}

async function genNumber(prefix: string, collName: string, field: string): Promise<string> {
  const year = new Date().getFullYear();
  const p = `${prefix}-${year}-`;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), collName),
      where(field, '>=', p), where(field, '<=', `${p}\uf8ff`),
      orderBy(field, 'desc'), limit(1),
    ));
    if (!snap.empty) {
      const last = snap.docs[0].data()[field] as string;
      return `${p}${String(parseInt(last.split('-').pop() || '0', 10) + 1).padStart(4, '0')}`;
    }
  } catch {
    const all = await getDocs(collection(getFirebaseFirestore(), collName));
    return `${p}${String(all.size + 1).padStart(4, '0')}`;
  }
  return `${p}0001`;
}

async function getEbmrOrThrow(id: string): Promise<EbmrRecord> {
  const rec = await getEbmrById(id);
  if (!rec) throw new Error('eBMR record not found');
  if (!isEbmrEditable(rec)) throw new Error('eBMR is locked and cannot be modified');
  return rec;
}

async function updateBatchStatus(id: string, status: string, extra: Partial<EbmrRecord> = {}) {
  await updateDoc(doc(getFirebaseFirestore(), EBMR_COLLECTIONS.records, id), { batch_status: status, updated_at: now(), ...extra });
}

// ─── eBMR Record ─────────────────────────────────────────────────────────────

export async function createEbmr(input: EbmrCreateInput, actor: EbmrActor): Promise<EbmrRecord> {
  const ebmrNumber = await genNumber('EBMR', EBMR_COLLECTIONS.records, 'ebmr_number');
  const timestamp = now();
  const record: Omit<EbmrRecord, 'id'> = {
    ebmr_number: ebmrNumber,
    product_name: input.product_name,
    generic_name: input.generic_name,
    strength: input.strength,
    batch_number: input.batch_number,
    batch_size: input.batch_size,
    batch_size_litres: input.batch_size_litres ?? null,
    std_fill_volume_ml: input.std_fill_volume_ml ?? null,
    batch_size_nos: input.batch_size_nos ?? null,
    mfg_date: input.mfg_date,
    exp_date: input.exp_date,
    mfr_number: input.mfr_number,
    bmr_version: input.bmr_version,
    manufacturing_license_no: input.manufacturing_license_no,
    manufacturing_area: input.manufacturing_area,
    market: input.market,
    customer: input.customer,
    batch_status: 'Line Clearance Pending',
    is_locked: false,
    line_clearance_verified: false,
    dispensing_complete: false,
    linked_deviation_ids: [],
    linked_oos_ids: [],
    created_by: actor.id,
    created_by_name: actor.name,
    reviewed_by: '',
    reviewed_by_name: '',
    approved_by: '',
    approved_by_name: '',
    remarks: input.remarks,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.records), record);
  await auditLog(actor, 'CREATE', refDoc.id, null, record);
  return { id: refDoc.id, ...record };
}

export async function getEbmrById(id: string): Promise<EbmrRecord | null> {
  const snap = await getDoc(doc(getFirebaseFirestore(), EBMR_COLLECTIONS.records, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as EbmrRecord;
}

export async function listEbmr(filters?: EbmrFilters): Promise<EbmrRecord[]> {
  const constraints: QueryConstraint[] = [orderBy('updated_at', 'desc')];
  if (filters?.batch_status) constraints.unshift(where('batch_status', '==', filters.batch_status));
  const snap = await getDocs(query(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.records), ...constraints));
  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EbmrRecord));
  if (filters?.search) {
    const s = filters.search.toLowerCase();
    rows = rows.filter((r) =>
      r.ebmr_number.toLowerCase().includes(s) || r.batch_number.toLowerCase().includes(s)
      || r.product_name.toLowerCase().includes(s),
    );
  }
  return rows;
}

export async function updateEbmr(id: string, input: Partial<EbmrCreateInput>, actor: EbmrActor): Promise<EbmrRecord> {
  const existing = await getEbmrOrThrow(id);
  const updates = { ...input, updated_at: now() } as UpdateData<DocumentData>;
  await updateDoc(doc(getFirebaseFirestore(), EBMR_COLLECTIONS.records, id), updates);
  await auditLog(actor, 'UPDATE', id, existing, updates);
  return { ...(await getEbmrById(id))! };
}

// ─── Line Clearance ──────────────────────────────────────────────────────────

export async function saveLineClearance(input: LineClearanceInput, actor: EbmrActor): Promise<LineClearanceRecord> {
  await getEbmrOrThrow(input.ebmr_doc_id);
  const record: Omit<LineClearanceRecord, 'id'> = {
    ebmr_doc_id: input.ebmr_doc_id,
    area_name: input.area_name,
    room_number: input.room_number,
    previous_product: input.previous_product,
    previous_batch_number: input.previous_batch_number,
    area_cleaned: input.area_cleaned,
    equipment_cleaned: input.equipment_cleaned,
    documents_removed: input.documents_removed,
    material_removed: input.material_removed,
    status_label_verified: input.status_label_verified,
    line_clearance_done_by: actor.id,
    line_clearance_done_by_name: actor.name,
    checked_by: '',
    checked_by_name: input.checked_by_name,
    qa_verified_by: input.qa_verified ? actor.id : '',
    qa_verified_by_name: input.qa_verified ? actor.name : '',
    clearance_datetime: input.clearance_datetime,
    status: input.qa_verified ? 'Verified' : 'Pending QA',
    qa_verified: input.qa_verified,
    remarks: input.remarks,
    created_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.lineClearance), record);
  await auditLog(actor, 'LINE_CLEARANCE', refDoc.id, null, record);

  if (input.qa_verified) {
    await updateBatchStatus(input.ebmr_doc_id, 'Dispensing Pending', { line_clearance_verified: true });
    await notify('Line Clearance Verified', `Batch line clearance QA verified`, input.ebmr_doc_id, ['production_manager']);
  }
  return { id: refDoc.id, ...record };
}

export async function listLineClearance(ebmrDocId: string): Promise<LineClearanceRecord[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), EBMR_COLLECTIONS.lineClearance),
    where('ebmr_doc_id', '==', ebmrDocId), orderBy('created_at', 'desc'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as LineClearanceRecord));
}

export async function isLineClearanceVerified(ebmrDocId: string): Promise<boolean> {
  const ebmr = await getEbmrById(ebmrDocId);
  if (ebmr?.line_clearance_verified) return true;
  const records = await listLineClearance(ebmrDocId);
  return records.some((r) => r.qa_verified);
}

// ─── Dispensing ──────────────────────────────────────────────────────────────

export async function saveEbmrDispensing(input: EbmrDispensingInput, actor: EbmrActor): Promise<EbmrDispensingRecord> {
  const ebmr = await getEbmrOrThrow(input.ebmr_doc_id);
  if (!ebmr.line_clearance_verified && !(await isLineClearanceVerified(input.ebmr_doc_id))) {
    throw new Error('Line clearance must be QA verified before dispensing');
  }

  const balance = input.required_quantity - input.dispensed_quantity;
  const record: Omit<EbmrDispensingRecord, 'id'> = {
    ebmr_doc_id: input.ebmr_doc_id,
    material_type: input.material_type,
    material_name: input.material_name,
    material_code: input.material_code,
    ar_number: input.ar_number,
    material_mfg_date: input.material_mfg_date,
    material_exp_date: input.material_exp_date,
    vendor_name: input.vendor_name,
    required_quantity: input.required_quantity,
    dispensed_quantity: input.dispensed_quantity,
    unit: input.unit,
    balance_quantity: balance,
    dispensed_by: actor.id,
    dispensed_by_name: actor.name,
    checked_by: '',
    checked_by_name: input.checked_by_name,
    qa_verified_by: input.qa_verified_by_name,
    qa_verified_by_name: input.qa_verified_by_name,
    status: input.verified ? 'Verified' : 'Pending',
    verified: input.verified,
    remarks: input.remarks,
    created_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.dispensing), record);
  await auditLog(actor, 'DISPENSING', refDoc.id, null, record);

  const allDisp = await listEbmrDispensing(input.ebmr_doc_id);
  const allVerified = allDisp.length > 0 && allDisp.every((d) => d.verified);
  if (allVerified) {
    await updateBatchStatus(input.ebmr_doc_id, 'Manufacturing In Progress', { dispensing_complete: true });
  }
  return { id: refDoc.id, ...record };
}

export async function listEbmrDispensing(ebmrDocId: string): Promise<EbmrDispensingRecord[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), EBMR_COLLECTIONS.dispensing),
    where('ebmr_doc_id', '==', ebmrDocId), orderBy('created_at', 'desc'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as EbmrDispensingRecord));
}

// ─── Manufacturing Steps ─────────────────────────────────────────────────────

export async function saveManufacturingStep(input: ManufacturingStepInput, actor: EbmrActor): Promise<ManufacturingStepRecord> {
  const ebmr = await getEbmrOrThrow(input.ebmr_doc_id);
  if (!ebmr.dispensing_complete) {
    const disp = await listEbmrDispensing(input.ebmr_doc_id);
    if (!disp.length || !disp.every((d) => d.verified)) {
      throw new Error('Dispensing must be complete before manufacturing steps');
    }
  }

  const record: Omit<ManufacturingStepRecord, 'id'> = {
    ebmr_doc_id: input.ebmr_doc_id,
    step_number: input.step_number,
    process_stage: input.process_stage,
    instruction: input.instruction,
    start_datetime: input.start_datetime,
    end_datetime: input.end_datetime,
    performed_by: actor.id,
    performed_by_name: actor.name,
    checked_by: '',
    checked_by_name: input.checked_by_name,
    observed_value: input.observed_value,
    acceptance_criteria: input.acceptance_criteria,
    status: input.status,
    remarks: input.remarks,
    created_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.manufacturingSteps), record);
  await auditLog(actor, 'MFG_STEP', refDoc.id, null, record);
  await updateBatchStatus(input.ebmr_doc_id, 'Manufacturing In Progress');
  return { id: refDoc.id, ...record };
}

export async function listManufacturingSteps(ebmrDocId: string): Promise<ManufacturingStepRecord[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), EBMR_COLLECTIONS.manufacturingSteps),
    where('ebmr_doc_id', '==', ebmrDocId), orderBy('step_number', 'asc'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ManufacturingStepRecord));
}

// ─── Equipment Usage ─────────────────────────────────────────────────────────

export async function saveEquipmentUsage(input: EquipmentUsageInput, actor: EbmrActor): Promise<EquipmentUsageRecord> {
  await getEbmrOrThrow(input.ebmr_doc_id);

  const selectable = await isEquipmentSelectable(input.equipment_doc_id);
  const eq = await getEquipmentById(input.equipment_doc_id);
  if (!selectable || !eq) {
    throw new Error('Equipment not qualified/calibrated for use');
  }
  if (input.cleaning_status !== 'Compliant' || input.sterilization_status !== 'Compliant'
    || input.qualification_status !== 'Compliant') {
    throw new Error('Equipment cleaning/sterilization/qualification must be compliant');
  }
  if (['Failed', 'Overdue'].includes(eq.calibration_status)) {
    throw new Error('Equipment calibration not compliant');
  }

  const record: Omit<EquipmentUsageRecord, 'id'> = {
    ebmr_doc_id: input.ebmr_doc_id,
    equipment_id: input.equipment_id,
    equipment_doc_id: input.equipment_doc_id,
    equipment_name: input.equipment_name,
    process_stage: input.process_stage,
    cleaning_status: input.cleaning_status,
    sterilization_status: input.sterilization_status,
    qualification_status: input.qualification_status,
    calibration_status: eq.calibration_status,
    usage_start_time: input.usage_start_time,
    usage_end_time: input.usage_end_time,
    compliance_status: 'Compliant',
    remarks: input.remarks,
    created_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.equipmentUsage), record);
  await auditLog(actor, 'EQUIPMENT_USAGE', refDoc.id, null, record);
  return { id: refDoc.id, ...record };
}

export async function listEquipmentUsage(ebmrDocId: string): Promise<EquipmentUsageRecord[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), EBMR_COLLECTIONS.equipmentUsage),
    where('ebmr_doc_id', '==', ebmrDocId), orderBy('created_at', 'desc'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as EquipmentUsageRecord));
}

// ─── CPP Records ─────────────────────────────────────────────────────────────

async function linkDeviation(ebmrDocId: string, devId: string) {
  const ebmr = await getEbmrById(ebmrDocId);
  if (!ebmr) return;
  const ids = Array.from(new Set([...ebmr.linked_deviation_ids, devId]));
  await updateDoc(doc(getFirebaseFirestore(), EBMR_COLLECTIONS.records, ebmrDocId), { linked_deviation_ids: ids, updated_at: now() });
}

async function createDeviationFromCpp(ebmr: EbmrRecord, cpp: CppRecordInput, actor: EbmrActor) {
  try {
    return await createDeviation({
      title: `CPP OOT — ${cpp.parameter_name} (${ebmr.batch_number})`,
      description: `${cpp.process_stage}: ${cpp.parameter_name} = ${cpp.observed_value} ${cpp.unit} (limits ${cpp.lsl}–${cpp.usl})`,
      department: 'Production',
      product_name: ebmr.product_name,
      area: ebmr.manufacturing_area || 'Production',
      category: 'Process',
      criticality: 'Major',
      planned_type: 'Unplanned',
      immediate_action: 'CPP out of tolerance — investigation required',
      reported_by_name: actor.name,
      detected_by_name: actor.name,
      deviation_date: today(),
      batch_number: ebmr.batch_number,
    }, { id: actor.id, name: actor.name, role: actor.role }, {
      status: 'draft', source: 'manual', source_reference: ebmr.ebmr_number,
    });
  } catch { return null; }
}

export async function saveCppRecord(input: CppRecordInput, actor: EbmrActor): Promise<CppRecord> {
  const ebmr = await getEbmrOrThrow(input.ebmr_doc_id);
  const status = classifyCppValue(input.observed_value, input.lsl, input.usl);
  let deviation: Awaited<ReturnType<typeof createDeviationFromCpp>> = null;

  if (status === 'OOT') {
    deviation = await createDeviationFromCpp(ebmr, input, actor);
    if (deviation) await linkDeviation(input.ebmr_doc_id, deviation.id);
    await notify('CPP OOT', `${input.parameter_name} out of tolerance for batch ${ebmr.batch_number}`, input.ebmr_doc_id, ['qa_manager']);
  }

  const record: Omit<CppRecord, 'id'> = {
    ebmr_doc_id: input.ebmr_doc_id,
    process_stage: input.process_stage,
    parameter_name: input.parameter_name,
    target: input.target,
    lsl: input.lsl,
    usl: input.usl,
    observed_value: input.observed_value,
    unit: input.unit,
    recorded_time: input.recorded_time,
    recorded_by: actor.id,
    recorded_by_name: actor.name,
    status,
    linked_deviation_id: deviation?.id || null,
    linked_deviation_number: deviation?.deviation_number || null,
    remarks: input.remarks,
    created_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.cppRecords), record);
  await auditLog(actor, 'CPP', refDoc.id, null, record);
  return { id: refDoc.id, ...record };
}

export async function listCppRecords(ebmrDocId: string): Promise<CppRecord[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), EBMR_COLLECTIONS.cppRecords),
    where('ebmr_doc_id', '==', ebmrDocId), orderBy('recorded_time', 'desc'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CppRecord));
}

// ─── IPC Checks ──────────────────────────────────────────────────────────────

export async function saveIpcCheck(input: IpcCheckInput, actor: EbmrActor): Promise<IpcCheckRecord> {
  const ebmr = await getEbmrOrThrow(input.ebmr_doc_id);
  const failed = input.observed_result.toLowerCase().includes('fail')
    || input.observed_result.toLowerCase().includes('reject')
    || input.observed_result.toLowerCase().includes('oos');

  let deviationId: string | null = null;
  let oosId: string | null = null;
  let refNumber: string | null = null;

  if (failed) {
    const isOosParam = (OOS_IPC_CHECKS as readonly string[]).includes(input.check_name);
    if (isOosParam) {
      try {
        const observedNum = parseFloat(input.observed_result) || 0;
        const oos = await createOosRecord({
          oos_date: today(),
          department: 'QC',
          product_name: ebmr.product_name,
          batch_number: ebmr.batch_number,
          test_name: input.check_name,
          test_method: 'IPC Check',
          stp_number: 'IPC-AUTO',
          specification_number: 'IPC-SPEC',
          parameter_name: input.check_name,
          spec_lower_limit: 0,
          spec_upper_limit: 999999,
          observed_result: observedNum,
          unit: input.unit || '',
          is_critical_test: true,
        }, { id: actor.id, name: actor.name, role: actor.role }, { status: 'draft', source: 'manual', source_reference: ebmr.ebmr_number });
        oosId = oos.id;
        refNumber = oos.oos_number;
        const ebmr2 = await getEbmrById(input.ebmr_doc_id);
        if (ebmr2) {
          await updateDoc(doc(getFirebaseFirestore(), EBMR_COLLECTIONS.records, input.ebmr_doc_id), {
            linked_oos_ids: Array.from(new Set([...ebmr2.linked_oos_ids, oos.id])), updated_at: now(),
          });
        }
      } catch { /* swallow */ }
    } else {
      const dev = await createDeviationFromCpp(ebmr, {
        ...input, process_stage: 'IPC', parameter_name: input.check_name,
        target: 0, lsl: 0, usl: 0, observed_value: 0, unit: input.unit, recorded_time: input.check_datetime,
      } as CppRecordInput, actor);
      if (dev) {
        deviationId = dev.id;
        refNumber = dev.deviation_number;
        await linkDeviation(input.ebmr_doc_id, dev.id);
      }
    }
    await notify('IPC Failure', `${input.check_name} failed for batch ${ebmr.batch_number}`, input.ebmr_doc_id, ['qa_manager', 'qc_manager']);
  }

  const record: Omit<IpcCheckRecord, 'id'> = {
    ebmr_doc_id: input.ebmr_doc_id,
    check_name: input.check_name,
    frequency: input.frequency,
    specification: input.specification,
    observed_result: input.observed_result,
    unit: input.unit,
    checked_by: actor.id,
    checked_by_name: actor.name,
    check_datetime: input.check_datetime,
    status: failed ? 'Failed' : 'Pass',
    linked_deviation_id: deviationId,
    linked_oos_id: oosId,
    linked_reference_number: refNumber,
    remarks: input.remarks,
    created_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.ipcChecks), record);
  await auditLog(actor, 'IPC', refDoc.id, null, record);

  const allIpc = await listIpcChecks(input.ebmr_doc_id);
  if (allIpc.length >= 3) await updateBatchStatus(input.ebmr_doc_id, 'IPC Pending');
  return { id: refDoc.id, ...record };
}

export async function listIpcChecks(ebmrDocId: string): Promise<IpcCheckRecord[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), EBMR_COLLECTIONS.ipcChecks),
    where('ebmr_doc_id', '==', ebmrDocId), orderBy('check_datetime', 'desc'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as IpcCheckRecord));
}

export async function listAllCppRecords(): Promise<CppRecord[]> {
  const snap = await getDocs(query(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.cppRecords), orderBy('recorded_time', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CppRecord));
}

export async function listAllIpcChecks(): Promise<IpcCheckRecord[]> {
  const snap = await getDocs(query(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.ipcChecks), orderBy('check_datetime', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as IpcCheckRecord));
}

export async function listAllManufacturingSteps(): Promise<ManufacturingStepRecord[]> {
  const snap = await getDocs(query(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.manufacturingSteps), orderBy('created_at', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ManufacturingStepRecord));
}

// ─── Review & Release ────────────────────────────────────────────────────────

export async function saveEbmrReview(input: EbmrReviewInput, actor: EbmrActor): Promise<EbmrReviewRecord> {
  const ebmr = await getEbmrOrThrow(input.ebmr_doc_id);
  const record: Omit<EbmrReviewRecord, 'id'> = {
    ebmr_doc_id: input.ebmr_doc_id,
    review_type: input.review_type,
    reviewer: actor.id,
    reviewer_name: actor.name,
    review_date: today(),
    decision: input.decision,
    comments: input.comments,
    created_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.reviews), record);
  await auditLog(actor, 'REVIEW', refDoc.id, null, record);

  const statusMap: Record<string, string> = { Approved: 'Approved', Rejected: 'Rejected', Hold: 'Hold' };
  await updateDoc(doc(getFirebaseFirestore(), EBMR_COLLECTIONS.records, input.ebmr_doc_id), {
    batch_status: statusMap[input.decision] || 'QA Review',
    reviewed_by: actor.id,
    reviewed_by_name: actor.name,
    updated_at: now(),
  });
  return { id: refDoc.id, ...record };
}

export async function listEbmrReviews(ebmrDocId: string): Promise<EbmrReviewRecord[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), EBMR_COLLECTIONS.reviews),
    where('ebmr_doc_id', '==', ebmrDocId), orderBy('created_at', 'desc'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as EbmrReviewRecord));
}

export async function releaseEbmr(input: EbmrReleaseInput, actor: EbmrActor): Promise<EbmrReleaseRecord> {
  const ebmr = await getEbmrById(input.ebmr_doc_id);
  if (!ebmr) throw new Error('eBMR not found');
  if (ebmr.batch_status !== 'Approved') {
    throw new Error('Batch must be QA approved before release');
  }

  const releaseNo = await genNumber('REL', EBMR_COLLECTIONS.release, 'release_number');
  const record: Omit<EbmrReleaseRecord, 'id'> = {
    ebmr_doc_id: input.ebmr_doc_id,
    release_number: releaseNo,
    released_by: actor.id,
    released_by_name: actor.name,
    release_date: today(),
    decision: input.decision,
    remarks: input.remarks,
    created_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.release), record);
  await auditLog(actor, 'RELEASE', refDoc.id, null, record);

  if (input.decision === 'Released') {
    await updateDoc(doc(getFirebaseFirestore(), EBMR_COLLECTIONS.records, input.ebmr_doc_id), {
      batch_status: 'Released', is_locked: true,
      approved_by: actor.id, approved_by_name: actor.name, updated_at: now(),
    });
    await notify('Batch Released', `${ebmr.product_name} batch ${ebmr.batch_number} released`, input.ebmr_doc_id, ['production_manager', 'qa_manager']);
  } else {
    await updateDoc(doc(getFirebaseFirestore(), EBMR_COLLECTIONS.records, input.ebmr_doc_id), {
      batch_status: 'Rejected', updated_at: now(),
    });
  }
  return { id: refDoc.id, ...record };
}

export async function listEbmrReleases(ebmrDocId: string): Promise<EbmrReleaseRecord[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), EBMR_COLLECTIONS.release),
    where('ebmr_doc_id', '==', ebmrDocId), orderBy('created_at', 'desc'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as EbmrReleaseRecord));
}

// ─── Attachments & Audit ─────────────────────────────────────────────────────

export async function uploadEbmrAttachment(ebmrDocId: string, file: File, category: string, actor: EbmrActor) {
  await getEbmrOrThrow(ebmrDocId);
  const path = `ebmr/${ebmrDocId}/${Date.now()}_${file.name}`;
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, file);
  const downloadUrl = await getDownloadURL(storageRef);
  const att: Omit<EbmrAttachment, 'id'> = {
    ebmr_doc_id: ebmrDocId, file_name: file.name, file_type: file.type, category,
    download_url: downloadUrl, uploaded_by: actor.id, uploaded_by_name: actor.name, uploaded_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EBMR_COLLECTIONS.attachments), att);
  await auditLog(actor, 'ATTACHMENT', refDoc.id, null, att);
  return { id: refDoc.id, ...att };
}

export async function getEbmrAttachments(ebmrDocId: string): Promise<EbmrAttachment[]> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), EBMR_COLLECTIONS.attachments),
    where('ebmr_doc_id', '==', ebmrDocId), orderBy('uploaded_at', 'desc'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as EbmrAttachment));
}

export async function getAuditLogsForEbmr(ebmrDocId: string): Promise<Record<string, unknown>[]> {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), EBMR_COLLECTIONS.auditLogs),
      where('recordId', '==', ebmrDocId), orderBy('timestamp', 'desc'), limit(50),
    ));
    return snap.docs.map((d) => d.data());
  } catch {
    return [];
  }
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export function computeEbmrMetrics(records: EbmrRecord[]): EbmrDashboardMetrics {
  return {
    total: records.length,
    draft: records.filter((r) => r.batch_status === 'Draft').length,
    inProgress: records.filter((r) => ['Manufacturing In Progress', 'Dispensing Pending', 'Line Clearance Pending'].includes(r.batch_status)).length,
    qaReviewPending: records.filter((r) => r.batch_status === 'QA Review').length,
    released: records.filter((r) => r.batch_status === 'Released').length,
    hold: records.filter((r) => r.batch_status === 'Hold').length,
    rejected: records.filter((r) => r.batch_status === 'Rejected').length,
    deviationLinked: records.filter((r) => r.linked_deviation_ids.length > 0).length,
  };
}

export function ebmrChartData(
  records: EbmrRecord[], cppRecords: CppRecord[], ipcRecords: IpcCheckRecord[],
  steps: ManufacturingStepRecord[] = [],
) {
  const statusTrend: Record<string, number> = {};
  const releaseTrend: Record<string, number> = {};
  const cppTrend: Record<string, { total: number; oot: number }> = {};
  const ipcFailTrend: Record<string, number> = {};
  const stageProgress: Record<string, number> = {};

  for (const r of records) {
    const m = r.created_at.slice(0, 7);
    statusTrend[m] = (statusTrend[m] || 0) + 1;
    if (r.batch_status === 'Released') releaseTrend[m] = (releaseTrend[m] || 0) + 1;
  }
  for (const s of steps) {
    stageProgress[s.process_stage] = (stageProgress[s.process_stage] || 0) + 1;
  }
  for (const c of cppRecords) {
    const m = c.recorded_time.slice(0, 7);
    if (!cppTrend[m]) cppTrend[m] = { total: 0, oot: 0 };
    cppTrend[m].total++;
    if (c.status === 'OOT') cppTrend[m].oot++;
  }
  for (const i of ipcRecords) {
    if (i.status === 'Failed') {
      const m = i.check_datetime.slice(0, 7);
      ipcFailTrend[m] = (ipcFailTrend[m] || 0) + 1;
    }
  }

  return {
    statusTrend: Object.entries(statusTrend).sort().map(([name, value]) => ({ name, value })),
    releaseTrend: Object.entries(releaseTrend).sort().map(([name, value]) => ({ name, value })),
    cppCompliance: Object.entries(cppTrend).sort().map(([name, v]) => ({
      name, value: v.total ? Math.round(((v.total - v.oot) / v.total) * 100) : 100,
    })),
    ipcFailTrend: Object.entries(ipcFailTrend).sort().map(([name, value]) => ({ name, value })),
    stageProgress: Object.entries(stageProgress).map(([name, value]) => ({ name, value })),
  };
}

export async function listEbmrForPqr() {
  return listEbmr({});
}

export async function getEbmrFullData(ebmrDocId: string) {
  const [record, lineClearance, dispensing, steps, equipment, cpp, ipc, reviews, releases, attachments, auditLogs] = await Promise.all([
    getEbmrById(ebmrDocId), listLineClearance(ebmrDocId), listEbmrDispensing(ebmrDocId),
    listManufacturingSteps(ebmrDocId), listEquipmentUsage(ebmrDocId), listCppRecords(ebmrDocId),
    listIpcChecks(ebmrDocId), listEbmrReviews(ebmrDocId), listEbmrReleases(ebmrDocId),
    getEbmrAttachments(ebmrDocId), getAuditLogsForEbmr(ebmrDocId),
  ]);
  return { record, lineClearance, dispensing, steps, equipment, cpp, ipc, reviews, releases, attachments, auditLogs };
}

export async function exportEbmrCsv(records: EbmrRecord[]) {
  downloadCsv(
    `ebmr-${today()}.csv`,
    ['eBMR No', 'Product', 'Batch', 'MFG', 'EXP', 'Status'],
    records.map((r) => [r.ebmr_number, r.product_name, r.batch_number, r.mfg_date, r.exp_date, r.batch_status]),
  );
}

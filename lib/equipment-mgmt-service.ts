import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where,
  type DocumentData, type QueryConstraint, type UpdateData,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseFirestore, getFirebaseStorage } from '@/lib/firebase';
import { logAuditEvent } from '@/lib/admin/admin-service';
import { createDeviation } from '@/lib/deviation-service';
import { downloadCsv } from '@/lib/export-utils';
import {
  EQUIPMENT_COLLECTIONS, calcDowntimeHours, isEquipmentUsable,
  type EquipmentRecord, type CalibrationRecord, type PmRecord, type BreakdownRecord,
  type EquipmentStatusHistory, type EquipmentAttachment, type EquipmentFilters,
  type EquipmentDashboardMetrics, type EquipmentActor,
} from './equipment-mgmt-types';
import type { EquipmentCreateInput, CalibrationInput, PmInput, BreakdownInput } from './equipment-mgmt-schemas';

function now() { return new Date().toISOString(); }
function today() { return now().split('T')[0]; }

async function auditLog(actor: EquipmentActor, action: string, recordId: string, oldValue: unknown, newValue: unknown, reason = '') {
  await logAuditEvent({
    userId: actor.id, userName: actor.name, module: 'Equipment', recordId, action,
    oldValue: oldValue ? JSON.stringify(oldValue) : '',
    newValue: newValue ? JSON.stringify(newValue) : '',
    reason, ipAddress: 'client', device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
    status: 'Success',
  });
}

async function notify(title: string, message: string, recordId: string, roles: string[]) {
  try {
    for (const role of roles) {
      await addDoc(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.notifications), {
        title, message, module: 'Equipment', record_id: recordId, target_role: role,
        read: false, created_at: now(),
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

async function logStatusChange(equipmentDocId: string, equipmentId: string, oldStatus: string, newStatus: string, reason: string, actor: EquipmentActor) {
  await addDoc(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.statusHistory), {
    equipment_doc_id: equipmentDocId, equipment_id: equipmentId,
    old_status: oldStatus, new_status: newStatus, reason,
    changed_by: actor.id, changed_by_name: actor.name, changed_at: now(),
  });
}

// ─── Equipment Master ────────────────────────────────────────────────────────

export async function createEquipment(input: EquipmentCreateInput, actor: EquipmentActor): Promise<EquipmentRecord> {
  const equipmentId = input.equipment_id.trim();
  const all = await listEquipment({});
  if (all.some((e) => e.equipment_id.toLowerCase() === equipmentId.toLowerCase())) {
    throw new Error(`Equipment ID "${equipmentId}" already exists`);
  }

  const timestamp = now();
  const qualificationRequired = input.qualification_status !== 'Not Required';
  const record: Omit<EquipmentRecord, 'id'> = {
    equipment_id: equipmentId,
    equipment_name: input.equipment_name.trim(),
    qualification_status: input.qualification_status,
    manufacturing_line: input.manufacturing_line.trim(),
    equipment_type: 'Manufacturing Equipment',
    department: 'Production',
    area_room_no: '',
    make: '',
    model: '',
    serial_no: '',
    capacity: '',
    installation_date: null,
    calibration_required: false,
    pm_required: false,
    qualification_required: qualificationRequired,
    cleaning_required: false,
    equipment_status: 'Active',
    calibration_due_date: null,
    calibration_status: 'Not Required',
    pm_due_date: null,
    pm_status: 'Not Required',
    validation_id: null,
    remarks: '',
    is_deleted: false,
    created_by: actor.id,
    created_by_name: actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.master), record);
  await auditLog(actor, 'CREATE', refDoc.id, null, record);
  return { id: refDoc.id, ...record };
}

export async function getEquipmentById(id: string): Promise<EquipmentRecord | null> {
  const snap = await getDoc(doc(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.master, id));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.is_deleted) return null;
  return {
    id: snap.id,
    ...data,
    qualification_status: data.qualification_status || '',
    manufacturing_line: data.manufacturing_line || '',
  } as EquipmentRecord;
}

export async function listEquipment(filters?: EquipmentFilters): Promise<EquipmentRecord[]> {
  const constraints: QueryConstraint[] = [orderBy('updated_at', 'desc')];
  if (filters?.equipment_type) constraints.unshift(where('equipment_type', '==', filters.equipment_type));
  if (filters?.equipment_status) constraints.unshift(where('equipment_status', '==', filters.equipment_status));
  if (filters?.department) constraints.unshift(where('department', '==', filters.department));

  let records: EquipmentRecord[];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.master), ...constraints));
    records = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        qualification_status: data.qualification_status || '',
        manufacturing_line: data.manufacturing_line || '',
      } as EquipmentRecord;
    });
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.master));
    records = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        qualification_status: data.qualification_status || '',
        manufacturing_line: data.manufacturing_line || '',
      } as EquipmentRecord;
    });
  }

  records = records.filter((r) => !r.is_deleted);
  if (filters?.calibration_status) records = records.filter((r) => r.calibration_status === filters.calibration_status);
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    records = records.filter((r) =>
      r.equipment_id.toLowerCase().includes(q)
      || r.equipment_name.toLowerCase().includes(q)
      || (r.manufacturing_line || '').toLowerCase().includes(q)
      || (r.serial_no || '').toLowerCase().includes(q),
    );
  }
  return records;
}

export async function deleteEquipment(
  id: string,
  actor: EquipmentActor,
  reason: string,
): Promise<void> {
  const existing = await getEquipmentById(id);
  if (!existing) throw new Error('Equipment not found');
  if (!reason.trim()) throw new Error('Delete reason is required');

  const updates: UpdateData<DocumentData> = {
    is_deleted: true,
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: now(),
  };
  await updateDoc(doc(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.master, id), updates);
  await auditLog(actor, 'DELETE', id, existing, { is_deleted: true }, reason.trim());
}

export async function updateEquipment(id: string, input: Partial<EquipmentCreateInput>, actor: EquipmentActor): Promise<EquipmentRecord> {
  const existing = await getEquipmentById(id);
  if (!existing) throw new Error('Equipment not found');

  const nextId = input.equipment_id?.trim();
  if (nextId && nextId.toLowerCase() !== existing.equipment_id.toLowerCase()) {
    const all = await listEquipment({});
    if (all.some((e) => e.id !== id && e.equipment_id.toLowerCase() === nextId.toLowerCase())) {
      throw new Error(`Equipment ID "${nextId}" already exists`);
    }
  }

  const updates: UpdateData<DocumentData> = {
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: now(),
  };
  if (input.equipment_name !== undefined) updates.equipment_name = input.equipment_name.trim();
  if (nextId !== undefined) updates.equipment_id = nextId;
  if (input.qualification_status !== undefined) {
    updates.qualification_status = input.qualification_status;
    updates.qualification_required = input.qualification_status !== 'Not Required';
  }
  if (input.manufacturing_line !== undefined) updates.manufacturing_line = input.manufacturing_line.trim();

  await updateDoc(doc(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.master, id), updates);
  await auditLog(actor, 'EDIT', id, existing, updates);
  return { ...existing, ...updates } as EquipmentRecord;
}

export async function blockEquipment(id: string, actor: EquipmentActor, reason: string): Promise<EquipmentRecord> {
  const existing = await getEquipmentById(id);
  if (!existing) throw new Error('Equipment not found');
  await updateDoc(doc(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.master, id), {
    equipment_status: 'Blocked',
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: now(),
  });
  await logStatusChange(id, existing.equipment_id, existing.equipment_status, 'Blocked', reason, actor);
  await auditLog(actor, 'BLOCKING', id, existing, { equipment_status: 'Blocked' }, reason);
  await notify('Equipment Blocked', `${existing.equipment_name} blocked: ${reason}`, id, ['qa_manager', 'production']);
  return { ...(await getEquipmentById(id))! };
}

/** For batch/CPP/PQR — only active, usable equipment */
export async function listSelectableEquipment(): Promise<EquipmentRecord[]> {
  const all = await listEquipment({});
  return all.filter(isEquipmentUsable);
}

export async function isEquipmentSelectable(id: string): Promise<boolean> {
  const eq = await getEquipmentById(id);
  return eq ? isEquipmentUsable(eq) : false;
}

// ─── Calibration ─────────────────────────────────────────────────────────────

export async function createCalibration(input: CalibrationInput, actor: EquipmentActor): Promise<CalibrationRecord> {
  const recordNo = await genNumber('CAL', EQUIPMENT_COLLECTIONS.calibration, 'calibration_record_no');
  const record: Omit<CalibrationRecord, 'id'> = {
    calibration_record_no: recordNo,
    equipment_id: input.equipment_id,
    equipment_doc_id: input.equipment_doc_id,
    equipment_name: input.equipment_name,
    calibration_type: input.calibration_type,
    calibration_date: input.calibration_date,
    calibration_due_date: input.calibration_due_date,
    calibration_agency: input.calibration_agency,
    certificate_no: input.certificate_no,
    acceptance_criteria: input.acceptance_criteria,
    observed_result: input.observed_result,
    calibration_status: input.calibration_status,
    certificate_url: '',
    reviewed_by: actor.id,
    reviewed_by_name: actor.name,
    approved_by: '',
    approved_by_name: '',
    remarks: input.remarks,
    created_at: now(),
    updated_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.calibration), record);
  await auditLog(actor, 'CALIBRATION', input.equipment_doc_id, null, record);

  const eqUpdates: Partial<EquipmentRecord> = {
    calibration_due_date: input.calibration_due_date,
    calibration_status: input.calibration_status,
    updated_at: now(),
  };
  if (input.calibration_status === 'Failed') {
    const existing = await getEquipmentById(input.equipment_doc_id);
    eqUpdates.equipment_status = 'Blocked';
    if (existing && existing.equipment_status !== 'Blocked') {
      await logStatusChange(
        input.equipment_doc_id,
        input.equipment_id,
        existing.equipment_status,
        'Blocked',
        'Calibration failed',
        actor,
      );
    }
    await notify('Calibration Failed', `${input.equipment_name} calibration failed — equipment blocked`, input.equipment_doc_id, ['qa_manager', 'engineering']);
  }
  await updateDoc(doc(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.master, input.equipment_doc_id), eqUpdates);

  return { id: refDoc.id, ...record };
}

export async function listCalibrations(equipmentDocId?: string): Promise<CalibrationRecord[]> {
  try {
    const constraints: QueryConstraint[] = [orderBy('calibration_date', 'desc')];
    if (equipmentDocId) constraints.unshift(where('equipment_doc_id', '==', equipmentDocId));
    const snap = await getDocs(query(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.calibration), ...constraints));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CalibrationRecord));
  } catch (error) {
    try {
      const snap = equipmentDocId
        ? await getDocs(query(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.calibration), where('equipment_doc_id', '==', equipmentDocId)))
        : await getDocs(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.calibration));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CalibrationRecord));
    } catch (fallbackError) {
      console.error('listCalibrations failed:', fallbackError || error);
      return [];
    }
  }
}

export async function uploadCalibrationCertificate(
  equipmentDocId: string, calId: string, file: File, actor: EquipmentActor,
): Promise<string> {
  const path = `equipment/${equipmentDocId}/calibration/${calId}_${Date.now()}_${file.name}`;
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  await updateDoc(doc(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.calibration, calId), { certificate_url: url, updated_at: now() });
  await auditLog(actor, 'ATTACHMENT_UPLOAD', equipmentDocId, null, { calId, file: file.name });
  return url;
}

// ─── PM ──────────────────────────────────────────────────────────────────────

export async function createPmRecord(input: PmInput, actor: EquipmentActor): Promise<PmRecord> {
  const recordNo = await genNumber('PM', EQUIPMENT_COLLECTIONS.pm, 'pm_record_no');
  const record: Omit<PmRecord, 'id'> = {
    pm_record_no: recordNo,
    equipment_id: input.equipment_id,
    equipment_doc_id: input.equipment_doc_id,
    equipment_name: input.equipment_name,
    pm_type: input.pm_type,
    pm_date: input.pm_date,
    next_pm_due_date: input.next_pm_due_date,
    checklist_completed: input.checklist_completed,
    observation: input.observation,
    spare_parts_used: input.spare_parts_used,
    pm_status: input.pm_status,
    done_by: actor.id,
    done_by_name: actor.name,
    reviewed_by: '',
    reviewed_by_name: '',
    remarks: input.remarks,
    created_at: now(),
    updated_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.pm), record);
  await auditLog(actor, 'PM_RECORD', input.equipment_doc_id, null, record);
  await updateDoc(doc(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.master, input.equipment_doc_id), {
    pm_due_date: input.next_pm_due_date,
    pm_status: input.pm_status,
    updated_at: now(),
  });
  return { id: refDoc.id, ...record };
}

export async function listPmRecords(equipmentDocId?: string): Promise<PmRecord[]> {
  try {
    const constraints: QueryConstraint[] = [orderBy('pm_date', 'desc')];
    if (equipmentDocId) constraints.unshift(where('equipment_doc_id', '==', equipmentDocId));
    const snap = await getDocs(query(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.pm), ...constraints));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PmRecord));
  } catch (error) {
    try {
      const snap = equipmentDocId
        ? await getDocs(query(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.pm), where('equipment_doc_id', '==', equipmentDocId)))
        : await getDocs(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.pm));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PmRecord));
    } catch (fallbackError) {
      console.error('listPmRecords failed:', fallbackError || error);
      return [];
    }
  }
}

// ─── Breakdown ───────────────────────────────────────────────────────────────

async function createDeviationFromBreakdown(eq: EquipmentRecord, input: BreakdownInput, actor: EquipmentActor) {
  try {
    const dev = await createDeviation({
      title: `Equipment breakdown — ${eq.equipment_name}`,
      description: input.problem_description,
      department: eq.department === 'Utilities' ? 'Engineering' : eq.department,
      product_name: 'N/A',
      area: eq.area_room_no || eq.equipment_name,
      category: 'Equipment',
      criticality: input.impact_on_product_quality ? 'Major' : 'Minor',
      planned_type: 'Unplanned',
      immediate_action: input.immediate_action || 'Breakdown reported',
      reported_by_name: actor.name,
      detected_by_name: actor.name,
      deviation_date: input.breakdown_date,
    }, { id: actor.id, name: actor.name, role: actor.role }, {
      status: 'draft', source: 'manual', source_reference: eq.equipment_id,
    });
    return dev;
  } catch (e) {
    console.error('Deviation creation failed:', e);
    return null;
  }
}

export async function createBreakdown(input: BreakdownInput, actor: EquipmentActor): Promise<BreakdownRecord> {
  const eq = await getEquipmentById(input.equipment_doc_id);
  if (!eq) throw new Error('Equipment not found');

  const breakdownNo = await genNumber('BD', EQUIPMENT_COLLECTIONS.breakdown, 'breakdown_no');
  const downtime = calcDowntimeHours(input.start_time, input.end_time);

  let linkedDeviationId: string | null = null;
  let linkedDeviationNumber: string | null = null;
  if (input.impact_on_batch || input.impact_on_product_quality || input.deviation_required) {
    const dev = await createDeviationFromBreakdown(eq, input, actor);
    if (dev) {
      linkedDeviationId = dev.id;
      linkedDeviationNumber = dev.deviation_number;
    }
  }

  const record: Omit<BreakdownRecord, 'id'> = {
    breakdown_no: breakdownNo,
    equipment_id: input.equipment_id,
    equipment_doc_id: input.equipment_doc_id,
    equipment_name: input.equipment_name,
    breakdown_date: input.breakdown_date,
    reported_by: actor.id,
    reported_by_name: actor.name,
    problem_description: input.problem_description,
    impact_on_batch: input.impact_on_batch,
    impact_on_product_quality: input.impact_on_product_quality,
    immediate_action: input.immediate_action,
    root_cause: input.root_cause,
    corrective_action: input.corrective_action,
    start_time: input.start_time,
    end_time: input.end_time,
    downtime_hours: downtime,
    status: input.status,
    capa_required: input.capa_required,
    deviation_required: input.deviation_required,
    linked_deviation_id: linkedDeviationId,
    linked_deviation_number: linkedDeviationNumber,
    created_at: now(),
    updated_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.breakdown), record);
  await auditLog(actor, 'BREAKDOWN', input.equipment_doc_id, null, record);

  if (input.impact_on_product_quality) {
    await updateDoc(doc(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.master, input.equipment_doc_id), {
      equipment_status: 'Under Maintenance',
      updated_by: actor.id,
      updated_by_name: actor.name,
      updated_at: now(),
    });
    if (eq.equipment_status !== 'Under Maintenance') {
      await logStatusChange(
        input.equipment_doc_id,
        eq.equipment_id,
        eq.equipment_status,
        'Under Maintenance',
        'Breakdown with product quality impact',
        actor,
      );
    }
  }
  await notify('Equipment Breakdown', `${input.equipment_name} breakdown reported`, input.equipment_doc_id, ['qa_manager', 'engineering']);

  return { id: refDoc.id, ...record };
}

export async function listBreakdowns(equipmentDocId?: string): Promise<BreakdownRecord[]> {
  try {
    const constraints: QueryConstraint[] = [orderBy('breakdown_date', 'desc')];
    if (equipmentDocId) constraints.unshift(where('equipment_doc_id', '==', equipmentDocId));
    const snap = await getDocs(query(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.breakdown), ...constraints));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BreakdownRecord));
  } catch (error) {
    try {
      const snap = equipmentDocId
        ? await getDocs(query(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.breakdown), where('equipment_doc_id', '==', equipmentDocId)))
        : await getDocs(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.breakdown));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as BreakdownRecord));
    } catch (fallbackError) {
      console.error('listBreakdowns failed:', fallbackError || error);
      return [];
    }
  }
}

// ─── Attachments & Status History ────────────────────────────────────────────

export async function uploadEquipmentAttachment(
  equipmentDocId: string, file: File, category: string, actor: EquipmentActor,
): Promise<EquipmentAttachment> {
  const path = `equipment/${equipmentDocId}/${Date.now()}_${file.name}`;
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, file);
  const downloadUrl = await getDownloadURL(storageRef);
  const attachment: Omit<EquipmentAttachment, 'id'> = {
    equipment_doc_id: equipmentDocId, file_name: file.name, file_type: file.type, file_size: file.size,
    category, storage_path: path, download_url: downloadUrl,
    uploaded_by: actor.id, uploaded_by_name: actor.name, uploaded_at: now(),
  };
  const refDoc = await addDoc(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.attachments), attachment);
  await auditLog(actor, 'ATTACHMENT_UPLOAD', equipmentDocId, null, { file_name: file.name });
  return { id: refDoc.id, ...attachment };
}

export async function getEquipmentAttachments(equipmentDocId: string): Promise<EquipmentAttachment[]> {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.attachments),
      where('equipment_doc_id', '==', equipmentDocId), orderBy('uploaded_at', 'desc'),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as EquipmentAttachment));
  } catch (error) {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.attachments), where('equipment_doc_id', '==', equipmentDocId),
      ));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as EquipmentAttachment));
    } catch (fallbackError) {
      console.error('getEquipmentAttachments failed:', fallbackError || error);
      return [];
    }
  }
}

export async function getStatusHistory(equipmentDocId: string): Promise<EquipmentStatusHistory[]> {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.statusHistory),
      where('equipment_doc_id', '==', equipmentDocId), orderBy('changed_at', 'desc'),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as EquipmentStatusHistory));
  } catch {
    return [];
  }
}

export async function getAuditLogsForEquipment(equipmentDocId: string): Promise<Record<string, unknown>[]> {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.auditLogs),
      where('recordId', '==', equipmentDocId),
      where('moduleName', '==', 'Equipment'),
      orderBy('timestamp', 'desc'),
      limit(100),
    ));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        action: data.actionType || data.action,
        user_name: data.userName || data.user_name,
        timestamp: data.timestamp || data.dateTime || data.created_at,
      };
    });
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.auditLogs),
        where('recordId', '==', equipmentDocId),
        limit(100),
      ));
      return snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            ...data,
            action: data.actionType || data.action,
            user_name: data.userName || data.user_name,
            timestamp: data.timestamp || data.dateTime || data.created_at,
          } as Record<string, unknown>;
        })
        .filter((row) => String(row.moduleName || row.module || '') === 'Equipment')
        .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    } catch {
      return [];
    }
  }
}

// ─── Sync & Dashboard ────────────────────────────────────────────────────────

export async function syncEquipmentDueDates(): Promise<number> {
  const t = today();
  const snap = await getDocs(collection(getFirebaseFirestore(), EQUIPMENT_COLLECTIONS.master));
  let count = 0;

  for (const d of snap.docs) {
    const data = d.data() as EquipmentRecord;
    if (data.is_deleted) continue;
    const updates: Partial<EquipmentRecord> = {};

    if (data.calibration_required && data.calibration_due_date) {
      if (data.calibration_due_date < t && !['Overdue', 'Failed', 'Not Required'].includes(data.calibration_status)) {
        updates.calibration_status = 'Overdue';
        await notify('Calibration Overdue', `${data.equipment_name} calibration overdue`, d.id, ['qa_manager', 'engineering']);
        count++;
      } else if (data.calibration_due_date <= addDays(t, 30) && data.calibration_status === 'Calibrated') {
        updates.calibration_status = 'Due';
        await notify('Calibration Due', `${data.equipment_name} calibration due soon`, d.id, ['engineering']);
      }
    }

    if (data.pm_required && data.pm_due_date) {
      if (data.pm_due_date < t && !['Overdue', 'Failed', 'Not Required'].includes(data.pm_status)) {
        updates.pm_status = 'Overdue';
        await notify('PM Overdue', `${data.equipment_name} PM overdue`, d.id, ['engineering', 'maintenance']);
        count++;
      } else if (data.pm_due_date <= addDays(t, 14) && data.pm_status === 'Completed') {
        updates.pm_status = 'Due';
        await notify('PM Due', `${data.equipment_name} PM due soon`, d.id, ['engineering']);
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = now();
      await updateDoc(d.ref, updates);
    }
  }
  return count;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export function computeDashboardMetrics(
  equipment: EquipmentRecord[], breakdowns: BreakdownRecord[],
): EquipmentDashboardMetrics {
  const t = today();
  const monthStart = t.slice(0, 7) + '-01';
  const active = equipment.filter((e) => e.equipment_status === 'Active').length;
  const blocked = equipment.filter((e) => ['Blocked', 'Under Maintenance'].includes(e.equipment_status)).length;
  const totalDowntime = breakdowns.filter((b) => b.breakdown_date >= monthStart).reduce((s, b) => s + b.downtime_hours, 0);
  const hoursInMonth = 720;
  const availability = equipment.length > 0
    ? Math.max(0, Math.round(((hoursInMonth * equipment.length - totalDowntime) / (hoursInMonth * equipment.length)) * 100))
    : 100;

  return {
    total: equipment.length,
    active,
    blocked,
    calibrationDue: equipment.filter((e) => e.calibration_status === 'Due').length,
    calibrationOverdue: equipment.filter((e) => e.calibration_status === 'Overdue').length,
    pmDue: equipment.filter((e) => e.pm_status === 'Due').length,
    pmOverdue: equipment.filter((e) => e.pm_status === 'Overdue').length,
    breakdownsThisMonth: breakdowns.filter((b) => b.breakdown_date >= monthStart).length,
    availabilityPercent: availability,
  };
}

export function equipmentChartData(equipment: EquipmentRecord[], breakdowns: BreakdownRecord[]) {
  const calTrend: Record<string, number> = {};
  const pmTrend: Record<string, number> = {};
  const bdTrend: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byDept: Record<string, number> = {};

  for (const e of equipment) {
    byStatus[e.equipment_status] = (byStatus[e.equipment_status] || 0) + 1;
    byDept[e.department] = (byDept[e.department] || 0) + 1;
    if (e.calibration_due_date) {
      const m = e.calibration_due_date.slice(0, 7);
      calTrend[m] = (calTrend[m] || 0) + 1;
    }
    if (e.pm_due_date) {
      const m = e.pm_due_date.slice(0, 7);
      pmTrend[m] = (pmTrend[m] || 0) + 1;
    }
  }
  for (const b of breakdowns) {
    const m = b.breakdown_date.slice(0, 7);
    bdTrend[m] = (bdTrend[m] || 0) + 1;
  }

  const toChart = (obj: Record<string, number>) =>
    Object.entries(obj).sort().map(([name, value]) => ({ name, value }));

  return {
    calTrend: toChart(calTrend),
    pmTrend: toChart(pmTrend),
    bdTrend: toChart(bdTrend),
    byStatus: toChart(byStatus),
    byDept: toChart(byDept),
  };
}

export async function listEquipmentForPqr(): Promise<EquipmentRecord[]> {
  return listEquipment({});
}

export async function exportEquipmentCsv(equipment: EquipmentRecord[]) {
  downloadCsv(
    `equipment-${today()}.csv`,
    ['Equipment ID', 'Name', 'Qualification Status', 'Manufacturing Line', 'Status'],
    equipment.map((e) => [
      e.equipment_id,
      e.equipment_name,
      e.qualification_status || '',
      e.manufacturing_line || '',
      e.equipment_status,
    ]),
  );
}

export async function exportCalibrationsCsv(records: CalibrationRecord[]) {
  downloadCsv(
    `calibrations-${today()}.csv`,
    ['Record No', 'Equipment', 'Date', 'Due Date', 'Status', 'Agency'],
    records.map((r) => [r.calibration_record_no, r.equipment_name, r.calibration_date, r.calibration_due_date, r.calibration_status, r.calibration_agency]),
  );
}

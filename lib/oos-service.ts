import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured } from '@/lib/firebase';
import { logAuditEvent } from '@/lib/admin/admin-service';
import { generateDocumentNumber } from '@/lib/admin/document-numbering-service';
import { downloadCsv } from '@/lib/export-utils';
import { computeExtendedOosDashboardMetrics } from './oos-dashboard-records';
import {
  OOS_COLLECTIONS, type OosRecord, type OosPhase1, type OosPhase2,
  type OosImpactAssessment, type OosCapaLink, type OosApproval, type OosAttachment,
  type OosFilters, type OosDashboardMetrics, type OosActor,
  computeResultStatus, isOpenOosStatus, isCriticalTest, buildLegacySpecification,
} from './oos-types';

function now() { return new Date().toISOString(); }

async function audit(actor: OosActor, action: string, recordId: string, oldValue: unknown, newValue: unknown, reason = '') {
  await logAuditEvent({
    userId: actor.id, userName: actor.name, module: 'OOS', recordId, action,
    oldValue: oldValue ? JSON.stringify(oldValue) : '',
    newValue: newValue ? JSON.stringify(newValue) : '',
    reason,
    ipAddress: typeof window !== 'undefined' ? 'client' : 'server',
    device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
    status: 'Success',
  });
}

async function notifyOos(title: string, message: string, oosId: string, roles: string[]) {
  try {
    for (const role of roles) {
      await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.notifications), {
        title, message, module: 'OOS', record_id: oosId, target_role: role,
        read: false, created_at: now(),
      });
    }
  } catch (e) { console.error('Notification failed:', e); }
}

export async function generateOosNumber(department = 'QC'): Promise<string> {
  const deptMap: Record<string, string> = { QC: 'QC', QA: 'QA', Production: 'PRD', Microbiology: 'MIC', Engineering: 'ENG', Warehouse: 'WH' };
  const dept = deptMap[department] || department.slice(0, 3).toUpperCase() || 'QC';
  const year = new Date().getFullYear();

  try {
    const result = await generateDocumentNumber('OOS', 'OOS Investigation', {
      departmentCode: dept,
      date: new Date(),
      increment: true,
    });
    if (result.number) return result.number;
  } catch (e) {
    console.error('generateDocumentNumber OOS', e);
  }

  const prefix = `OOS/${dept}/${year}/`;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.records),
      where('oos_number', '>=', prefix),
      where('oos_number', '<=', `${prefix}\uf8ff`),
      orderBy('oos_number', 'desc'),
      limit(1),
    ));
    if (!snap.empty) {
      const last = snap.docs[0].data().oos_number as string;
      const seq = parseInt(last.split('/').pop() || '0', 10) + 1;
      return `${prefix}${String(seq).padStart(4, '0')}`;
    }
  } catch {
    try {
      const all = await getDocs(collection(getFirebaseFirestore(), OOS_COLLECTIONS.records));
      return `${prefix}${String(all.size + 1).padStart(4, '0')}`;
    } catch (e) {
      console.error('generateOosNumber fallback', e);
    }
  }
  return `${prefix}0001`;
}

async function linkBatch(batchNumber: string) {
  if (!batchNumber) return { batch_id: null, pqr_id: null };
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.batches),
      where('batch_number', '==', batchNumber),
      limit(1),
    ));
    if (snap.empty) return { batch_id: null, pqr_id: null };
    const data = snap.docs[0].data();
    return { batch_id: snap.docs[0].id, pqr_id: (data.pqr_id as string) || null };
  } catch { return { batch_id: null, pqr_id: null }; }
}

async function blockBatchRelease(batchId: string | null, block: boolean) {
  if (!batchId) return;
  try {
    await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.batches, batchId), {
      release_blocked: block,
      release_block_reason: block ? 'Critical OOS — batch release blocked' : null,
      updated_at: now(),
    });
  } catch { /* batch may not exist */ }
}

export async function setBatchReleaseEligibility(batchId: string | null, block: boolean) {
  await blockBatchRelease(batchId, block);
}

export async function createOosRecord(
  input: {
    oos_date: string; department: string; product_name: string; batch_number: string;
    test_name: string; test_method: string; stp_number: string; specification_number: string;
    parameter_name: string; spec_lower_limit: number; spec_upper_limit: number;
    observed_result: number; unit: string; is_critical_test?: boolean;
    target_closure_date?: string | null;
    sample_type?: string;
    analyst_name?: string;
    instrument_used?: string;
    initial_observation?: string;
    immediate_action?: string;
    batch_release_blocked?: boolean;
    capa_required?: boolean;
    assigned_to?: string | null;
    assigned_to_name?: string | null;
    remarks?: string;
    product_id?: string | null;
  },
  actor: OosActor,
  options?: {
    status?: string;
    source?: string;
    source_reference?: string;
    cpv_record_id?: string;
    stability_record_id?: string;
    cqa_result_id?: string;
  },
): Promise<OosRecord> {
  const resultStatus = computeResultStatus(input.observed_result, input.spec_lower_limit, input.spec_upper_limit);
  const critical = input.is_critical_test ?? isCriticalTest(input.test_name);
  const batchLink = await linkBatch(input.batch_number);
  const oosNumber = await generateOosNumber(input.department);
  const timestamp = now();
  const spec = buildLegacySpecification(input.spec_lower_limit, input.spec_upper_limit, input.unit);

  const isOos = resultStatus === 'OOS';
  const isDraft = options?.status === 'draft';
  const batchBlocked = input.batch_release_blocked ?? (isOos && Boolean(input.batch_number));

  const record: Omit<OosRecord, 'id'> = {
    oos_number: oosNumber,
    oos_date: input.oos_date,
    department: input.department,
    product_name: input.product_name,
    product_id: input.product_id ?? null,
    batch_number: input.batch_number,
    batch_id: batchLink.batch_id,
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
    result_status: resultStatus,
    test_parameter: input.parameter_name,
    specification: spec,
    obtained_result: String(input.observed_result),
    is_critical_test: critical,
    batch_release_blocked: batchBlocked,
    status: options?.status || (isDraft ? 'draft' : isOos ? 'submitted' : 'draft'),
    phase: 'phase1',
    capa_required: input.capa_required ?? false,
    linked_capa_number: null,
    linked_capa_id: null,
    target_closure_date: input.target_closure_date || null,
    actual_closure_date: null,
    root_cause: '',
    source: (options?.source as OosRecord['source']) || 'manual',
    source_reference: options?.source_reference || null,
    cpv_record_id: options?.cpv_record_id || null,
    cqa_result_id: options?.cqa_result_id || null,
    stability_record_id: options?.stability_record_id || null,
    pqr_id: batchLink.pqr_id,
    assigned_to: input.assigned_to ?? null,
    assigned_to_name: input.assigned_to_name ?? null,
    analyst_name: input.analyst_name,
    instrument_used: input.instrument_used,
    initial_observation: input.initial_observation,
    immediate_action: input.immediate_action,
    remarks: input.remarks || '',
    created_by: actor.id,
    created_by_name: actor.name,
    created_at: timestamp,
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: timestamp,
  };

  const refDoc = await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.records), record);
  await audit(actor, 'CREATE', refDoc.id, null, record);

  if (isOos && !isDraft) {
    await triggerOosWorkflow(refDoc.id, record, actor, batchLink.batch_id, critical);
  }

  return { id: refDoc.id, ...record };
}

async function triggerOosWorkflow(
  oosId: string,
  record: Omit<OosRecord, 'id'>,
  actor: OosActor,
  batchId: string | null,
  critical: boolean,
) {
  await createPhase1Placeholder(oosId, actor);
  await notifyOos('OOS Detected', `${record.oos_number} — ${record.test_name} failed for batch ${record.batch_number}`, oosId, ['qa_manager', 'qc_manager', 'head_qa']);
  if (critical) {
    await notifyOos('Critical OOS', `${record.oos_number} — critical test ${record.test_name} requires Head QA review`, oosId, ['head_qa']);
  }
  if (record.batch_release_blocked && batchId) {
    await blockBatchRelease(batchId, true);
  }
}

export async function submitOosWorkflow(oosId: string, actor: OosActor): Promise<OosRecord | null> {
  const record = await getOosById(oosId);
  if (!record) return null;
  const isOos = record.result_status === 'OOS';
  const timestamp = now();

  await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.records, oosId), {
    status: 'submitted',
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: timestamp,
  });

  if (isOos) {
    await triggerOosWorkflow(oosId, record, actor, record.batch_id, record.is_critical_test);
    try {
      const { initializeOosApprovalWorkflow } = await import('./oos-approval-service');
      await initializeOosApprovalWorkflow(oosId, actor);
    } catch (e) {
      console.error('initializeOosApprovalWorkflow', e);
    }
  }

  return getOosById(oosId);
}

export async function createPhase1Placeholder(oosId: string, actor: OosActor) {
  try {
    const existing = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.phase1),
      where('oos_id', '==', oosId),
      limit(1),
    ));
    if (!existing.empty) return;
  } catch { /* continue to create */ }
  const timestamp = now();
  await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.phase1), {
    oos_id: oosId,
    phase1_id: `P1-PENDING-${oosId.slice(0, 8)}`,
    status: 'Not Started',
    analyst_name: '', instrument_used: '', instrument_calibration_status: '',
    standard_used: '', reagent_used: '',
    calculation_verified: false, data_review_completed: false,
    chromatogram_attached: false, raw_data_attached: false,
    glassware_verified: false, method_followed_correctly: false,
    sample_preparation_verified: false, chromatogram_raw_data_reviewed: false,
    analyst_interview_completed: false, lab_error_observed: false,
    assignable_cause_identified: false,
    investigation_findings: '', root_cause_identified: '', phase1_conclusion: '',
    phase1_outcome: 'Inconclusive',
    investigator_id: actor.id, investigator_name: actor.name,
    started_at: timestamp, completed_at: null,
    created_by: actor.id, created_by_name: actor.name,
    updated_by: actor.id, updated_by_name: actor.name,
    created_at: timestamp, updated_at: timestamp,
  });
}

export async function createOosFromCpv(
  cpvData: { id: string; product: string; batchNumber: string; parameter: string; observedValue: number; lower: number; upper: number; unit: string; status: string },
  actor: OosActor,
): Promise<OosRecord | null> {
  if (cpvData.status !== 'OOS') return null;
  const existing = await getDocs(query(
    collection(getFirebaseFirestore(), OOS_COLLECTIONS.records),
    where('cpv_record_id', '==', cpvData.id),
    limit(1),
  ));
  if (!existing.empty) return { id: existing.docs[0].id, ...existing.docs[0].data() } as OosRecord;

  return createOosRecord({
    oos_date: now().split('T')[0],
    department: 'QC',
    product_name: cpvData.product,
    batch_number: cpvData.batchNumber,
    test_name: cpvData.parameter,
    test_method: 'CPV Monitoring',
    stp_number: 'CPV-AUTO',
    specification_number: 'CPV-SPEC',
    parameter_name: cpvData.parameter,
    spec_lower_limit: cpvData.lower,
    spec_upper_limit: cpvData.upper,
    observed_result: cpvData.observedValue,
    unit: cpvData.unit,
    is_critical_test: isCriticalTest(cpvData.parameter),
  }, actor, { source: 'cpv_cqa', source_reference: cpvData.id, cpv_record_id: cpvData.id, status: 'submitted' });
}

export async function getOosById(id: string): Promise<OosRecord | null> {
  const snap = await getDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.records, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as OosRecord;
}

export async function listOosRecords(filters?: OosFilters): Promise<OosRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.records),
      orderBy('created_at', 'desc'),
      limit(1000),
    ));
    let results = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OosRecord));

    if (filters?.status) results = results.filter((r) => r.status === filters.status);
    if (filters?.department) results = results.filter((r) => r.department === filters.department);
    if (filters?.product_name) {
      const q = filters.product_name.toLowerCase();
      results = results.filter((r) => (r.product_name || '').toLowerCase().includes(q));
    }
    if (filters?.batch_number) results = results.filter((r) => (r.batch_number || '').includes(filters.batch_number!));
    if (filters?.oos_number) results = results.filter((r) => (r.oos_number || '').includes(filters.oos_number!));
    if (filters?.test_name) results = results.filter((r) => (r.test_name || '').toLowerCase().includes(filters.test_name!.toLowerCase()));
    if (filters?.capa_linked !== undefined) {
      results = results.filter((r) => Boolean(r.linked_capa_number) === filters.capa_linked);
    }
    if (filters?.capa_required !== undefined) {
      results = results.filter((r) => r.capa_required === filters.capa_required);
    }
    if (filters?.assigned_to) {
      const q = filters.assigned_to.toLowerCase();
      results = results.filter((r) => (r.assigned_to_name || '').toLowerCase().includes(q));
    }
    if (filters?.overdue_only) {
      results = results.filter((r) => r.status === 'overdue' || (r.target_closure_date && r.target_closure_date < new Date().toISOString().split('T')[0] && isOpenOosStatus(r.status)));
    }
    if (filters?.date_from) results = results.filter((r) => r.oos_date >= filters.date_from!);
    if (filters?.date_to) results = results.filter((r) => r.oos_date <= filters.date_to!);
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      results = results.filter((r) =>
        (r.oos_number || '').toLowerCase().includes(q) ||
        (r.product_name || '').toLowerCase().includes(q) ||
        (r.batch_number || '').toLowerCase().includes(q) ||
        (r.test_name || '').toLowerCase().includes(q),
      );
    }

    return results.map(applyOverdueCheck);
  } catch (e) {
    console.error('listOosRecords failed', e);
    return [];
  }
}

function applyOverdueCheck(record: OosRecord): OosRecord {
  if (!record.target_closure_date || ['closed', 'approved'].includes(record.status)) return record;
  const today = new Date().toISOString().split('T')[0];
  if (record.target_closure_date < today && isOpenOosStatus(record.status)) {
    return { ...record, status: 'overdue' };
  }
  return record;
}

export async function updateOosRecord(
  id: string, updates: Partial<OosRecord>, actor: OosActor, options?: { workflow?: boolean },
): Promise<OosRecord> {
  const existing = await getOosById(id);
  if (!existing) throw new Error('OOS record not found');

  const workflowFields = new Set([
    'status', 'phase', 'root_cause', 'capa_required', 'linked_capa_number', 'linked_capa_id',
    'batch_release_blocked', 'actual_closure_date', 'assigned_to', 'assigned_to_name',
    'updated_by', 'updated_by_name', 'updated_at',
  ]);
  if (!options?.workflow && existing.status !== 'draft') {
    const keys = Object.keys(updates).filter((k) => !workflowFields.has(k));
    if (keys.length > 0) throw new Error('Only draft OOS records can be fully edited');
  }

  const payload: Partial<OosRecord> = {
    ...updates,
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: now(),
  };

  if (updates.observed_result !== undefined && updates.spec_lower_limit !== undefined && updates.spec_upper_limit !== undefined) {
    payload.result_status = computeResultStatus(updates.observed_result, updates.spec_lower_limit, updates.spec_upper_limit);
    payload.obtained_result = String(updates.observed_result);
  }

  await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.records, id), payload);
  await audit(actor, 'UPDATE', id, existing, { ...existing, ...payload });
  return { ...existing, ...payload } as OosRecord;
}

export async function submitOos(id: string, actor: OosActor): Promise<OosRecord> {
  const existing = await getOosById(id);
  if (!existing) throw new Error('OOS not found');
  if (existing.result_status !== 'OOS') throw new Error('Only OOS results can be submitted for investigation');
  const updated = await updateOosRecord(id, { status: 'phase1_investigation', phase: 'phase1' }, actor, { workflow: true });
  await audit(actor, 'SUBMIT', id, existing, updated);
  await notifyOos('OOS Submitted', `${existing.oos_number} submitted for Phase-I investigation`, id, ['qa_manager', 'qc_manager']);
  return updated;
}

export async function savePhase1(
  oosId: string,
  data: Omit<OosPhase1, 'id' | 'oos_id' | 'created_at' | 'updated_at'>,
  actor: OosActor,
): Promise<OosPhase1> {
  const { savePhase1Draft } = await import('./oos-phase1-service');
  const result = await savePhase1Draft(oosId, {
    analyst_name: data.analyst_name,
    instrument_used: data.instrument_used,
    instrument_calibration_status: data.instrument_calibration_status,
    standard_used: data.standard_used,
    reagent_used: data.reagent_used,
    calculation_verified: data.calculation_verified,
    data_review_completed: data.data_review_completed,
    chromatogram_attached: data.chromatogram_attached,
    raw_data_attached: data.raw_data_attached,
    investigation_findings: data.investigation_findings,
    root_cause_identified: data.root_cause_identified,
    phase1_conclusion: data.phase1_conclusion,
    phase1_outcome: data.phase1_outcome,
    qc_investigator_id: data.investigator_id,
    qc_investigator: data.investigator_name,
  }, { id: actor.id, name: actor.name, role: actor.role });
  if (result.error || !result.phase1) throw new Error(result.error || 'Failed to save Phase-I');
  await audit(actor, 'PHASE1_UPDATE', oosId, null, result.phase1);
  return result.phase1;
}

export async function getPhase1(oosId: string): Promise<OosPhase1 | null> {
  const snap = await getDocs(query(collection(getFirebaseFirestore(), OOS_COLLECTIONS.phase1), where('oos_id', '==', oosId), limit(1)));
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as OosPhase1;
}

export async function savePhase2(
  oosId: string,
  data: Omit<OosPhase2, 'id' | 'oos_id' | 'created_at' | 'updated_at'>,
  actor: OosActor,
): Promise<OosPhase2> {
  const { savePhase2Draft } = await import('./oos-phase2-service');
  const result = await savePhase2Draft(oosId, {
    assigned_investigator: data.investigator_name,
    assigned_investigator_id: data.investigator_id,
    manufacturing_review: data.manufacturing_review || data.process_review,
    batch_record_review: data.batch_record_review,
    raw_material_review: data.raw_material_review,
    equipment_review: data.equipment_review,
    environmental_review: data.environmental_review,
    operator_review: data.operator_review,
    process_review: data.process_review,
    deviation_review: data.deviation_review,
    change_control_review: data.change_control_review,
    root_cause: data.root_cause,
    impact_assessment: data.impact_assessment,
    corrective_action: data.corrective_action,
    preventive_action: data.preventive_action,
    final_investigation_conclusion: data.conclusion,
    conclusion: data.conclusion,
  }, { id: actor.id, name: actor.name, role: actor.role });
  if (result.error || !result.phase2) throw new Error(result.error || 'Failed to save Phase-II');
  await audit(actor, 'PHASE2_UPDATE', oosId, null, result.phase2);
  return result.phase2;
}

export async function getPhase2(oosId: string): Promise<OosPhase2 | null> {
  const snap = await getDocs(query(collection(getFirebaseFirestore(), OOS_COLLECTIONS.phase2), where('oos_id', '==', oosId), limit(1)));
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as OosPhase2;
}

export async function saveImpactAssessment(
  oosId: string,
  data: Omit<OosImpactAssessment, 'id' | 'oos_id' | 'created_at' | 'updated_at'>,
  actor: OosActor,
): Promise<OosImpactAssessment> {
  const { saveOosImpactDraft } = await import('./oos-impact-service');
  const result = await saveOosImpactDraft(oosId, {
    assessment_date: data.assessment_date || new Date().toISOString().split('T')[0],
    assessed_by_name: data.assessed_by_name,
    product_quality_impact: data.product_quality_impact || (data.product_impact?.toLowerCase().includes('yes') ? 'Yes' : 'No'),
    batch_impact: data.batch_impact || 'No',
    patient_safety_impact: data.patient_safety_impact || 'No',
    regulatory_impact: data.regulatory_impact || 'No',
    market_impact: data.market_impact || 'Not Applicable',
    stability_impact: data.stability_impact || 'Not Applicable',
    validation_impact: data.validation_impact || 'Not Applicable',
    other_batches_impacted: data.other_batches_impacted === 'Yes' ? 'Yes' : 'No',
    impacted_batch_numbers: data.impacted_batch_numbers || data.other_batches_impacted,
    impact_description: data.impact_description || data.product_impact,
    scientific_justification: data.scientific_justification || data.impact_description || data.product_impact,
    severity: data.severity ?? 3,
    occurrence: data.occurrence ?? 3,
    detection: data.detection ?? 3,
    capa_required: data.capa_required ?? false,
    deviation_required: data.deviation_required ?? false,
    recall_evaluation_required: data.recall_evaluation_required ?? data.recall_required ?? false,
    recall_evaluation_reason: data.recall_evaluation_reason,
    conclusion: data.conclusion,
    qa_comments: data.qa_comments,
  }, { id: actor.id, name: actor.name, role: actor.role });
  if (result.error || !result.impact) throw new Error(result.error || 'Failed to save impact assessment');
  await audit(actor, 'IMPACT_ASSESSMENT', oosId, null, result.impact);
  return result.impact;
}

export async function getImpactAssessment(oosId: string): Promise<OosImpactAssessment | null> {
  const snap = await getDocs(query(collection(getFirebaseFirestore(), OOS_COLLECTIONS.impactAssessments), where('oos_id', '==', oosId), limit(1)));
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as OosImpactAssessment;
}

export async function linkCapa(
  oosId: string, capaNumber: string, capaId: string | null, capaStatus: string,
  targetDate: string | null, effectivenessCheck: string, actor: OosActor,
): Promise<OosCapaLink> {
  const { linkExistingCapaToOos } = await import('./oos-capa-service');
  const result = await linkExistingCapaToOos(oosId, capaNumber, effectivenessCheck || '', actor);
  if (result.error || !result.link) throw new Error(result.error || 'Failed to link CAPA');
  return result.link;
}

export async function createCapaFromOos(oosId: string, actor: OosActor): Promise<{ capaNumber: string; capaId: string }> {
  const { createOosCapaFromRecord } = await import('./oos-capa-service');
  const { mapOosCapaFormDefaults } = await import('./oos-capa-records');
  const record = await getOosById(oosId);
  if (!record) throw new Error('OOS not found');
  const phase2 = await getPhase2(oosId);
  const result = await createOosCapaFromRecord(oosId, {
    ...mapOosCapaFormDefaults(record, null, null, phase2),
    capa_required: true,
    root_cause: phase2?.root_cause || record.root_cause || 'Pending investigation',
    corrective_action: phase2?.corrective_action || 'To be defined',
    preventive_action: phase2?.preventive_action || 'To be defined',
    action_owner_name: record.assigned_to_name || actor.name,
    target_completion_date: record.target_closure_date || new Date().toISOString().split('T')[0],
    effectiveness_check_required: true,
  }, actor);
  if (result.error || !result.capa) throw new Error(result.error || 'Failed to create CAPA');
  return { capaNumber: result.capa.capa_number, capaId: result.capa.id };
}

export async function getCapaLink(oosId: string): Promise<OosCapaLink | null> {
  const { getActiveOosCapaLink } = await import('./oos-capa-service');
  return getActiveOosCapaLink(oosId);
}

export async function submitApproval(
  oosId: string,
  data: { decision: 'approved' | 'rejected'; comments: string; e_signature: string },
  actor: OosActor,
): Promise<OosApproval> {
  const {
    approveOosStep,
    getCurrentPendingOosApproval,
    getOosApprovals,
    initializeOosApprovalWorkflow,
    rejectOosStep,
  } = await import('./oos-approval-service');

  let approvals = await getOosApprovals(oosId);
  let current = getCurrentPendingOosApproval(approvals);
  if (!current) {
    await initializeOosApprovalWorkflow(oosId, actor);
    approvals = await getOosApprovals(oosId);
    current = getCurrentPendingOosApproval(approvals);
  }
  if (!current) throw new Error('No pending approval step found');

  if (data.decision === 'rejected') {
    const result = await rejectOosStep(oosId, current.id, data.comments, data.comments, actor);
    if (result.error) throw new Error(result.error);
    return { ...current, decision: 'rejected', comments: data.comments };
  }

  const result = await approveOosStep(oosId, current.id, data.comments, data.e_signature, actor);
  if (result.error) throw new Error(result.error);
  return { ...current, decision: 'approved', comments: data.comments, e_signature: data.e_signature };
}

export async function closeOos(id: string, actor: OosActor): Promise<OosRecord> {
  const { validateOosCanClose } = await import('./oos-capa-service');
  const check = await validateOosCanClose(id);
  if (!check.canClose) throw new Error(check.reason || 'OOS cannot be closed — open mandatory CAPA exists.');
  const existing = await getOosById(id);
  const updated = await updateOosRecord(id, { status: 'closed', actual_closure_date: now().split('T')[0] }, actor, { workflow: true });
  if (existing?.batch_release_blocked && existing.batch_id) {
    await setBatchReleaseEligibility(existing.batch_id, false);
    await updateOosRecord(id, { batch_release_blocked: false }, actor, { workflow: true });
  }
  await audit(actor, 'CLOSE', id, null, updated);
  return updated;
}

export async function getApprovals(oosId: string): Promise<OosApproval[]> {
  const { getOosApprovals } = await import('./oos-approval-service');
  return getOosApprovals(oosId);
}

export async function uploadAttachment(
  oosId: string, file: File, category: OosAttachment['category'], actor: OosActor,
): Promise<OosAttachment> {
  const path = `oos/${oosId}/${Date.now()}_${file.name}`;
  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, file);
  const fileUrl = await getDownloadURL(storageRef);
  const timestamp = now();
  const attachment: Omit<OosAttachment, 'id'> = {
    oos_id: oosId, file_name: file.name, file_url: fileUrl, file_type: file.type,
    file_size: file.size, category, uploaded_by: actor.id, uploaded_by_name: actor.name, uploaded_at: timestamp,
  };
  const ref2 = await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.attachments), attachment);
  await audit(actor, 'ATTACHMENT_UPLOAD', oosId, null, { file_name: file.name, category });
  return { id: ref2.id, ...attachment };
}

export async function getAttachments(oosId: string): Promise<OosAttachment[]> {
  const snap = await getDocs(query(collection(getFirebaseFirestore(), OOS_COLLECTIONS.attachments), where('oos_id', '==', oosId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as OosAttachment));
}

export async function deleteAttachment(attachmentId: string, actor: OosActor): Promise<void> {
  const snap = await getDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.attachments, attachmentId));
  if (!snap.exists()) return;
  const data = snap.data() as OosAttachment;
  await deleteDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.attachments, attachmentId));
  await audit(actor, 'ATTACHMENT_DELETE', data.oos_id, data, null);
}

export async function getAuditLogsForOos(oosId: string) {
  const { getAuditLogsForOos: fetchMerged } = await import('./oos-audit-trail-service');
  return fetchMerged(oosId);
}

export function computeOosDashboardMetrics(records: OosRecord[], phase1Records: OosPhase1[]): OosDashboardMetrics {
  return computeExtendedOosDashboardMetrics(records, phase1Records);
}

export async function syncOverdueOos(): Promise<number> {
  const records = await listOosRecords();
  const today = new Date().toISOString().split('T')[0];
  let count = 0;
  const batch = writeBatch(getFirebaseFirestore());
  for (const r of records) {
    if (r.target_closure_date && r.target_closure_date < today && isOpenOosStatus(r.status) && r.status !== 'overdue') {
      batch.update(doc(getFirebaseFirestore(), OOS_COLLECTIONS.records, r.id), { status: 'overdue', updated_at: now() });
      count++;
    }
  }
  if (count > 0) await batch.commit();
  return count;
}

export function exportOosCsv(records: OosRecord[]) {
  downloadCsv(
    `oos_${new Date().toISOString().split('T')[0]}.csv`,
    ['OOS No.', 'Date', 'Department', 'Product', 'Batch', 'Test', 'Result', 'Status', 'CAPA', 'Critical'],
    records.map((r) => [
      r.oos_number, r.oos_date, r.department, r.product_name, r.batch_number,
      r.test_name, r.obtained_result, r.status, r.linked_capa_number || '—', r.is_critical_test ? 'Yes' : 'No',
    ]),
  );
}

export function canUserAccessOos(
  action: 'view' | 'create' | 'phase1' | 'phase2' | 'approve' | 'close',
  role: string,
): boolean {
  const r = role.toLowerCase();
  if (['super_admin', 'admin'].includes(r)) return true;
  if (r === 'auditor' || r === 'viewer') return action === 'view';
  if (['head_qa', 'qa_manager', 'qa'].includes(r)) return ['view', 'create', 'approve', 'close'].includes(action);
  if (['qc_manager', 'qc'].includes(r)) return ['view', 'create', 'phase1'].includes(action);
  if (['production_manager', 'production'].includes(r)) return ['view', 'phase2'].includes(action);
  return action === 'view';
}

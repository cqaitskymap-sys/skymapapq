import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { generateDocumentNumber } from '@/lib/admin/document-numbering-service';
import {
  RISK_ASSESSMENT_COLLECTION,
  RISK_CONTROLS_COLLECTION,
  buildRiskAssessmentId,
  calculateRiskAssessment,
  generateRiskNumber,
  type RiskControlRecord,
} from '@/lib/cpv-risk-assessment-records';
import { fetchRiskAssessmentRecords } from '@/lib/cpv-risk-assessment-service';
import { createRecord, updateRecord } from '@/lib/firestore';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { polishRecommendationText } from '@/lib/ai/client';
import { normalizeRole } from '@/lib/permissions';
import {
  RISK_CREATE_MODULE,
  RISK_REGISTER_COLLECTION,
  buildRiskNumberFallback,
  calculateResidualRisk,
  computeRiskCreateAutoRules,
  getRiskSourceLookupConfig,
  mapRiskSourceToPrefill,
  validateCategoryForRole,
  validateDepartmentForRole,
  type RiskBatchOption,
  type RiskCreateActor,
  type RiskDepartmentOption,
  type RiskOwnerOption,
  type RiskProductOption,
  type RiskSourceLookupResult,
} from '@/lib/risk-create-records';
import type { RiskCreateInput } from '@/lib/risk-create-schemas';

const NOTIFICATIONS = 'notifications';
const RISK_ASSESSMENTS_ALIAS = 'risk_assessments';
const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));

async function safeQuery(name: string, max = 500): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), name),
      orderBy('createdAt', 'desc'),
      limit(max),
    ));
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

async function audit(actor: RiskCreateActor, actionType: string, recordId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: RISK_CREATE_MODULE,
      collectionName: RISK_ASSESSMENT_COLLECTION,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('risk create audit', e);
  }
}

async function notify(title: string, message: string, recordId: string, userId?: string) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), NOTIFICATIONS), {
      title,
      message,
      module: RISK_CREATE_MODULE,
      record_id: recordId,
      user_id: userId || '',
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('risk create notify', e);
  }
}

async function notifyRole(title: string, message: string, recordId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  for (const role of roles) {
    try {
      await addDoc(collection(getFirebaseFirestore(), NOTIFICATIONS), {
        title,
        message,
        module: RISK_CREATE_MODULE,
        record_id: recordId,
        target_role: role,
        read: false,
        created_at: nowIso(),
      });
    } catch (e) {
      console.error('risk create notify role', e);
    }
  }
}

export async function fetchRiskCreateProducts(): Promise<RiskProductOption[]> {
  const rows = await safeQuery('products');
  const mapped = rows.map((r) => ({
    id: str(r.id),
    name: str(r.productName || r.product_name || r.name),
    code: str(r.productCode || r.product_code || r.code),
  })).filter((p) => p.name);
  if (mapped.length) return mapped.sort((a, b) => a.name.localeCompare(b.name));

  const batches = await safeQuery('batches');
  const fromBatches = new Map<string, RiskProductOption>();
  batches.forEach((b) => {
    const name = str(b.productName || b.product_name);
    if (!name) return;
    fromBatches.set(name, {
      id: str(b.productId || b.product_id || name),
      name,
      code: str(b.productCode || b.product_code),
    });
  });
  return Array.from(fromBatches.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchRiskCreateBatches(productName?: string): Promise<RiskBatchOption[]> {
  const merged: RiskBatchOption[] = [];
  for (const col of ['batches', 'cpv_batches']) {
    const rows = await safeQuery(col);
    rows.forEach((r) => {
      const pn = str(r.productName || r.product_name || r.product);
      if (productName && pn && pn !== productName) return;
      const batchNumber = str(r.batchNumber || r.batch_number || r.batchNo);
      if (!batchNumber) return;
      merged.push({
        id: str(r.id),
        batch_number: batchNumber,
        product_name: pn,
        product_code: str(r.productCode || r.product_code),
      });
    });
  }
  const unique = new Map<string, RiskBatchOption>();
  merged.forEach((b) => unique.set(b.batch_number, b));
  return Array.from(unique.values()).sort((a, b) => b.batch_number.localeCompare(a.batch_number));
}

export async function fetchRiskCreateDepartments(): Promise<RiskDepartmentOption[]> {
  const rows = await safeQuery('departments');
  const mapped = rows.map((r) => ({
    id: str(r.id),
    name: str(r.name || r.department_name || r.departmentName),
    code: str(r.code || r.department_code),
  })).filter((d) => d.name);
  if (mapped.length) return mapped.sort((a, b) => a.name.localeCompare(b.name));
  return [
    'QA', 'QC', 'Production', 'Engineering', 'Validation', 'Regulatory Affairs', 'CSV', 'Warehouse',
  ].map((name, i) => ({ id: `dept-${i}`, name }));
}

export async function fetchRiskCreateOwners(): Promise<RiskOwnerOption[]> {
  const rows = await safeQuery('users');
  return rows.map((r) => ({
    id: str(r.id || r.uid),
    name: str(r.full_name || r.fullName || r.displayName || r.email),
    department: str(r.department),
  })).filter((u) => u.id && u.name).sort((a, b) => a.name.localeCompare(b.name));
}

export async function generateRiskNumberPreview(): Promise<string> {
  const year = new Date().getFullYear();
  if (!isFirebaseConfigured()) return buildRiskNumberFallback(year, 1);
  try {
    const result = await generateDocumentNumber('RISK', 'Risk Assessment', {
      date: new Date(),
      increment: false,
    });
    if (result.number) return result.number;
  } catch (e) {
    console.error('generateRiskNumberPreview document numbering', e);
  }
  try {
    const records = await fetchRiskAssessmentRecords(500);
    const prefix = `RISK/${year}/`;
    const seqs = records
      .map((r) => r.riskNumber)
      .filter((n) => n.startsWith(prefix))
      .map((n) => parseInt(n.split('/').pop() || '0', 10))
      .filter((n) => Number.isFinite(n));
    const next = seqs.length ? Math.max(...seqs) + 1 : records.length + 1;
    return buildRiskNumberFallback(year, next);
  } catch {
    return buildRiskNumberFallback(year, 1);
  }
}

export async function lookupRiskSourceReference(
  source: string,
  referenceNumber: string,
): Promise<RiskSourceLookupResult> {
  if (!referenceNumber.trim()) return { found: false, message: 'Enter a reference number' };
  if (!isFirebaseConfigured()) return { found: false, message: 'Firebase not configured' };
  const config = getRiskSourceLookupConfig(source);
  if (!config) return { found: false, message: 'No lookup available for this source — enter details manually' };

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
    return mapRiskSourceToPrefill(source, docSnap.data() as Record<string, unknown>, docSnap.id);
  } catch (e) {
    console.error('lookupRiskSourceReference', e);
    return { found: false, message: 'Lookup failed' };
  }
}

function mapRiskSourceForRecord(source: string): string {
  if (source === 'Manual') return 'Manual Assessment';
  return source;
}

function buildInitialControls(input: RiskCreateInput): RiskControlRecord[] {
  const controls: RiskControlRecord[] = [];
  const owner = input.risk_owner_name || input.risk_owner;
  if (input.existing_controls?.trim()) {
    controls.push({
      controlId: `CTRL-EC-${Date.now()}`,
      controlDescription: input.existing_controls.trim(),
      controlType: 'Existing',
      owner,
      targetDate: '',
      status: 'Active',
      effectiveness: 'Pending',
    });
  }
  if (input.mitigation_plan?.trim()) {
    controls.push({
      controlId: `CTRL-MIT-${Date.now() + 1}`,
      controlDescription: input.mitigation_plan.trim(),
      controlType: 'Mitigation',
      owner,
      targetDate: input.target_completion_date || '',
      status: 'Planned',
      effectiveness: 'Pending',
    });
  }
  return controls;
}

function mapLinkedFields(source: string, ref: string) {
  const linked = {
    linkedCapaNumber: '',
    linkedDeviationNumber: '',
    linkedOosNumber: '',
    linkedChangeControlNumber: '',
  };
  switch (source) {
    case 'CAPA': linked.linkedCapaNumber = ref; break;
    case 'Deviation': linked.linkedDeviationNumber = ref; break;
    case 'OOS': linked.linkedOosNumber = ref; break;
    case 'Change Control': linked.linkedChangeControlNumber = ref; break;
    default: break;
  }
  return linked;
}

async function buildRiskPayload(
  input: RiskCreateInput,
  actor: RiskCreateActor,
  riskNumber: string,
  status: 'Draft' | 'Under Review',
) {
  const calc = calculateRiskAssessment(input.severity_score, input.occurrence_score, input.detection_score);
  const residual = calculateResidualRisk(
    input.residual_severity,
    input.residual_occurrence,
    input.residual_detection,
  );
  const auto = computeRiskCreateAutoRules({
    severity: input.severity_score,
    occurrence: input.occurrence_score,
    detection: input.detection_score,
    risk_category: input.risk_category,
    residual_severity: input.residual_severity,
    residual_occurrence: input.residual_occurrence,
    residual_detection: input.residual_detection,
  });
  const linked = mapLinkedFields(input.risk_source, input.source_reference_number);
  const aiRecommendation = await polishRecommendationText(calc.aiRecommendation, {
    module: 'Risk Management Create',
    riskTitle: input.risk_title,
    riskCategory: input.risk_category,
    riskLevel: calc.riskLevel,
    rpnScore: calc.rpnScore,
    riskDescription: input.risk_description,
  });

  return {
    riskAssessmentId: buildRiskAssessmentId(input.product_code || 'PRD'),
    riskNumber,
    riskDate: input.risk_date,
    riskTitle: input.risk_title,
    sourceReferenceNumber: input.source_reference_number,
    department: input.department,
    cpvProductId: '',
    productName: input.product_name,
    productCode: input.product_code,
    batchNumber: input.batch_number,
    riskCategory: input.risk_category,
    riskSource: mapRiskSourceForRecord(input.risk_source),
    processStage: input.process_area,
    parameterType: 'CPP' as const,
    parameterName: input.risk_title,
    riskDescription: input.risk_description,
    potentialFailureMode: input.potential_failure_mode,
    potentialImpact: input.potential_impact,
    potentialCause: input.potential_cause,
    existingControls: input.existing_controls,
    severityScore: input.severity_score,
    occurrenceScore: input.occurrence_score,
    detectionScore: input.detection_score,
    rpnScore: calc.rpnScore,
    riskLevel: calc.riskLevel,
    residualSeverity: input.residual_severity,
    residualOccurrence: input.residual_occurrence,
    residualDetection: input.residual_detection,
    residualRpn: residual.residualRpn,
    residualRiskLevel: residual.residualRiskLevel,
    aiRecommendation,
    riskStatus: status === 'Draft' ? 'Draft' as const : 'Under Review' as const,
    workflowStatus: status === 'Draft' ? 'Draft' as const : 'Review' as const,
    effectivenessStatus: 'Pending' as const,
    riskOwner: input.risk_owner_name || input.risk_owner,
    mitigationRequired: auto.mitigation_required,
    mitigationAction: input.mitigation_plan,
    targetCompletionDate: input.target_completion_date,
    reviewFrequency: input.review_frequency,
    effectivenessCheckRequired: true,
    capaSuggested: calc.riskLevel === 'Critical' || calc.riskLevel === 'High',
    isAutoGenerated: false,
    isLocked: false,
    reviewedBy: '',
    reviewDate: '',
    approvedBy: '',
    approvalDate: '',
    controls: buildInitialControls(input),
    reviews: [],
    remarks: input.remarks,
    createdByName: actor.name,
    updatedByName: actor.name,
    ...linked,
  };
}

async function syncRiskRegister(
  recordId: string,
  payload: Awaited<ReturnType<typeof buildRiskPayload>>,
  actor: RiskCreateActor,
) {
  if (!isFirebaseConfigured()) return;
  const registerPayload = {
    risk_assessment_id: recordId,
    risk_number: payload.riskNumber,
    risk_title: payload.riskTitle,
    risk_date: payload.riskDate,
    department: payload.department,
    product: payload.productName,
    batch_number: payload.batchNumber,
    risk_category: payload.riskCategory,
    risk_level: payload.riskLevel,
    rpn: payload.rpnScore,
    residual_rpn: payload.residualRpn,
    residual_risk_level: payload.residualRiskLevel,
    risk_status: payload.riskStatus,
    risk_owner: payload.riskOwner,
    updated_at: nowIso(),
    updated_by: actor.id,
    is_deleted: false,
  };
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RISK_REGISTER_COLLECTION),
      where('risk_assessment_id', '==', recordId),
      limit(1),
    ));
    if (snap.empty) {
      await addDoc(collection(getFirebaseFirestore(), RISK_REGISTER_COLLECTION), {
        ...registerPayload,
        created_at: nowIso(),
        created_by: actor.id,
      });
    } else {
      await updateDoc(doc(getFirebaseFirestore(), RISK_REGISTER_COLLECTION, snap.docs[0].id), registerPayload);
    }
  } catch (e) {
    console.error('syncRiskRegister', e);
  }
}

async function syncRiskControls(
  recordId: string,
  payload: Awaited<ReturnType<typeof buildRiskPayload>>,
  actor: RiskCreateActor,
) {
  if (!isFirebaseConfigured() || !payload.controls?.length) return;
  try {
    const existing = await getDocs(query(
      collection(getFirebaseFirestore(), RISK_CONTROLS_COLLECTION),
      where('risk_assessment_id', '==', recordId),
      limit(50),
    ));
    await Promise.all(existing.docs.map((d) => updateDoc(d.ref, {
      is_deleted: true,
      updated_at: nowIso(),
      updated_by: actor.id,
    })));
    await Promise.all(payload.controls.map((ctrl) => addDoc(collection(getFirebaseFirestore(), RISK_CONTROLS_COLLECTION), {
      ...ctrl,
      risk_assessment_id: recordId,
      risk_number: payload.riskNumber,
      created_at: nowIso(),
      updated_at: nowIso(),
      created_by: actor.id,
      updated_by: actor.id,
      is_deleted: false,
    })));
  } catch (e) {
    console.error('syncRiskControls', e);
  }
}

async function syncRiskAssessmentsAlias(
  recordId: string,
  payload: Awaited<ReturnType<typeof buildRiskPayload>>,
  input: RiskCreateInput,
  actor: RiskCreateActor,
) {
  if (!isFirebaseConfigured()) return;
  try {
    await setDoc(doc(getFirebaseFirestore(), RISK_ASSESSMENTS_ALIAS, recordId), {
      risk_number: payload.riskNumber,
      risk_date: input.risk_date,
      risk_title: input.risk_title,
      risk_source: input.risk_source,
      source_reference_number: input.source_reference_number,
      department: input.department,
      product: input.product_name,
      product_code: input.product_code,
      batch_number: input.batch_number,
      risk_category: input.risk_category,
      process_area: input.process_area,
      risk_description: input.risk_description,
      potential_failure_mode: input.potential_failure_mode,
      potential_impact: input.potential_impact,
      potential_cause: input.potential_cause,
      existing_controls: input.existing_controls,
      severity: input.severity_score,
      occurrence: input.occurrence_score,
      detection: input.detection_score,
      rpn: payload.rpnScore,
      risk_level: payload.riskLevel,
      risk_owner: payload.riskOwner,
      mitigation_required: payload.mitigationRequired,
      mitigation_plan: input.mitigation_plan,
      target_completion_date: input.target_completion_date,
      review_frequency: input.review_frequency,
      residual_severity: input.residual_severity,
      residual_occurrence: input.residual_occurrence,
      residual_detection: input.residual_detection,
      residual_rpn: payload.residualRpn,
      residual_risk_level: payload.residualRiskLevel,
      risk_status: payload.riskStatus,
      remarks: input.remarks,
      risk_assessment_id: recordId,
      updated_at: nowIso(),
      updated_by: actor.id,
      created_at: nowIso(),
      created_by: actor.id,
      is_deleted: false,
    }, { merge: true });
  } catch (e) {
    console.error('syncRiskAssessmentsAlias', e);
  }
}

async function syncRiskCreateSideEffects(
  recordId: string,
  payload: Awaited<ReturnType<typeof buildRiskPayload>>,
  input: RiskCreateInput,
  actor: RiskCreateActor,
) {
  await syncRiskRegister(recordId, payload, actor);
  await syncRiskControls(recordId, payload, actor);
  await syncRiskAssessmentsAlias(recordId, payload, input, actor);
}

async function applyNotifications(
  recordId: string,
  riskNumber: string,
  auto: ReturnType<typeof computeRiskCreateAutoRules>,
  ownerId?: string,
) {
  if (ownerId) await notify('Risk Assessment Created', riskNumber, recordId, ownerId);
  await notifyRole('Risk Assessment Submitted', `${riskNumber} submitted for review`, recordId, ['qa', 'qa_manager', 'risk_manager']);
  if (auto.notify_head_qa) await notifyRole('Critical Risk Created', riskNumber, recordId, ['head_qa']);
  if (auto.notify_csv) await notifyRole('CSV Risk Created', riskNumber, recordId, ['csv_manager']);
  if (auto.notify_regulatory) await notifyRole('Regulatory Risk Created', riskNumber, recordId, ['regulatory_affairs']);
}

function validateActorPermissions(actor: RiskCreateActor, input: RiskCreateInput) {
  const catErr = validateCategoryForRole(actor.role, input.risk_category);
  if (catErr) throw new Error(catErr);
  const deptErr = validateDepartmentForRole(actor.role, actor.department, input.department);
  if (deptErr) throw new Error(deptErr);
}

export async function saveRiskAssessmentDraft(
  input: RiskCreateInput,
  actor: RiskCreateActor,
  draftId?: string | null,
): Promise<{ id: string; riskNumber: string }> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured.');
  validateActorPermissions(actor, input);

  const existingRecords = await fetchRiskAssessmentRecords(500);
  let riskNumber = draftId
    ? existingRecords.find((r) => r.id === draftId)?.riskNumber
    : undefined;
  if (!riskNumber) {
    try {
      const result = await generateDocumentNumber('RISK', 'Risk Assessment', {
        date: new Date(),
        increment: false,
      });
      riskNumber = result.number || undefined;
    } catch { /* fallback below */ }
  }
  if (!riskNumber) riskNumber = generateRiskNumber(existingRecords.length);

  const payload = await buildRiskPayload(input, actor, riskNumber, 'Draft');

  if (draftId) {
    await updateRecord(RISK_ASSESSMENT_COLLECTION, draftId, payload, {
      moduleName: RISK_CREATE_MODULE,
      actor: { id: actor.id, name: actor.name },
    });
    await audit(actor, 'risk assessment updated', draftId, `Draft saved — ${riskNumber}`);
    await syncRiskCreateSideEffects(draftId, payload, input, actor);
    return { id: draftId, riskNumber };
  }

  const created = await createRecord(
    RISK_ASSESSMENT_COLLECTION,
    payload as Parameters<typeof createRecord>[1],
    { moduleName: RISK_CREATE_MODULE, actor: { id: actor.id, name: actor.name } },
  );
  const id = str(created.id);
  await audit(actor, 'risk assessment created', id, riskNumber);
  await syncRiskCreateSideEffects(id, payload, input, actor);
  return { id, riskNumber };
}

export async function submitRiskAssessmentCreate(
  input: RiskCreateInput,
  actor: RiskCreateActor,
  draftId?: string | null,
): Promise<{ id: string; riskNumber: string }> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured.');
  validateActorPermissions(actor, input);

  const auto = computeRiskCreateAutoRules({
    severity: input.severity_score,
    occurrence: input.occurrence_score,
    detection: input.detection_score,
    risk_category: input.risk_category,
    residual_severity: input.residual_severity,
    residual_occurrence: input.residual_occurrence,
    residual_detection: input.residual_detection,
  });

  const existingRecords = await fetchRiskAssessmentRecords(500);
  let riskNumber = draftId
    ? existingRecords.find((r) => r.id === draftId)?.riskNumber
    : undefined;

  if (!riskNumber) {
    try {
      const result = await generateDocumentNumber('RISK', 'Risk Assessment', {
        date: new Date(),
        increment: true,
      });
      riskNumber = result.number || undefined;
    } catch { /* fallback */ }
  }
  if (!riskNumber) riskNumber = generateRiskNumber(existingRecords.length);

  const payload = await buildRiskPayload(input, actor, riskNumber, 'Under Review');

  let recordId = draftId || '';
  if (draftId) {
    await updateRecord(RISK_ASSESSMENT_COLLECTION, draftId, payload, {
      moduleName: RISK_CREATE_MODULE,
      actor: { id: actor.id, name: actor.name },
    });
    recordId = draftId;
    await audit(actor, 'risk assessment submitted', recordId, `Submitted — RPN ${payload.rpnScore}`);
  } else {
    const created = await createRecord(
      RISK_ASSESSMENT_COLLECTION,
      payload as Parameters<typeof createRecord>[1],
      { moduleName: RISK_CREATE_MODULE, actor: { id: actor.id, name: actor.name } },
    );
    recordId = str(created.id);
    await audit(actor, 'risk assessment created', recordId, riskNumber);
    await audit(actor, 'risk assessment submitted', recordId, `Submitted — RPN ${payload.rpnScore}`);
  }

  await syncRiskCreateSideEffects(recordId, payload, input, actor);
  await applyNotifications(recordId, riskNumber, auto, input.risk_owner);

  if (auto.mitigation_required && normalizeRole(actor.role || '') === 'head_qa') {
    await audit(actor, 'critical risk flagged', recordId, 'Head QA notified');
  }

  return { id: recordId, riskNumber };
}

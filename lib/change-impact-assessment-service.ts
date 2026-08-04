import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { getFirebaseFirestore } from '@/lib/firebase';
import { logAuditEvent } from '@/lib/admin/admin-service';
import { downloadCsv } from '@/lib/export-utils';
import { listDocuments, getDocumentById } from '@/lib/dms-service';
import { generateChangeNumber } from '@/lib/change-control-service';
import type {
  DocumentChangeImpactRecord, ChangeImpactFilters, ChangeImpactActor, ImpactDependency,
} from './change-impact-assessment-types';
import {
  mapChangeImpactRaw, computeChangeImpactKpis, computeChangeImpactCharts,
  filterChangeImpactRecords, isDmsChangeImpactRecord, computeOverallImpact,
} from './change-impact-assessment-records';
import type { CreateImpactAssessmentInput, ApproveImpactInput, RejectImpactInput } from './change-impact-assessment-schemas';
import { CIA_COLLECTIONS, CIA_MODULE_TAG } from './change-impact-assessment-types';

function now() { return new Date().toISOString(); }

async function audit(actor: ChangeImpactActor, action: string, recordId: string, oldValue: unknown, newValue: unknown, reason = '') {
  await logAuditEvent({
    userId: actor.id, userName: actor.name, module: 'Change Impact Assessment', recordId, action,
    oldValue: oldValue ? JSON.stringify(oldValue) : '',
    newValue: newValue ? JSON.stringify(newValue) : '',
    reason, ipAddress: 'client', device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
    status: 'Success',
  });
}

async function notify(title: string, message: string, recordId: string, roles: string[] = []) {
  try {
    for (const role of roles) {
      await addDoc(collection(getFirebaseFirestore(), CIA_COLLECTIONS.notifications), {
        title, message, module: 'Change Impact Assessment', record_id: recordId,
        target_role: role, read: false, created_at: now(),
      });
    }
  } catch (e) { console.error('CIA notification failed:', e); }
}

export async function generateAssessmentNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CIA-${year}-`;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CIA_COLLECTIONS.assessments),
      where('assessment_number', '>=', prefix),
      where('assessment_number', '<=', `${prefix}\uf8ff`),
      orderBy('assessment_number', 'desc'),
      limit(1),
    ));
    if (!snap.empty) {
      const last = snap.docs[0].data().assessment_number as string;
      return `${prefix}${String(parseInt(last.split('-').pop() || '0', 10) + 1).padStart(4, '0')}`;
    }
  } catch {
    const all = await getDocs(query(
      collection(getFirebaseFirestore(), CIA_COLLECTIONS.assessments),
      where('module', '==', CIA_MODULE_TAG),
    ));
    return `${prefix}${String(all.size + 1).padStart(4, '0')}`;
  }
  return `${prefix}0001`;
}

async function listDmsImpactAssessments(): Promise<DocumentChangeImpactRecord[]> {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CIA_COLLECTIONS.assessments),
      where('module', '==', CIA_MODULE_TAG),
      orderBy('updated_at', 'desc'),
    ));
    return snap.docs.map((d) => mapChangeImpactRaw({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), CIA_COLLECTIONS.assessments));
    return snap.docs.map((d) => mapChangeImpactRaw({ id: d.id, ...d.data() }))
      .filter(isDmsChangeImpactRecord)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
}

export async function analyzeDocumentDependencies(documentId: string): Promise<{
  dependencies: ImpactDependency[];
  affected_departments: string[];
}> {
  const docRecord = await getDocumentById(documentId);
  if (!docRecord) return { dependencies: [], affected_departments: [] };

  const deps: ImpactDependency[] = [];
  const depts = new Set<string>([docRecord.department]);

  deps.push({
    type: 'Document', id: docRecord.id, number: docRecord.document_number, title: docRecord.document_title,
  });

  const allDocs = await listDocuments();
  const linked = allDocs.filter((d) =>
    d.change_control_ref === docRecord.document_number ||
    d.supersedes_document_no === docRecord.document_number ||
    d.parent_document_id === documentId,
  );
  for (const d of linked) {
    deps.push({ type: d.document_type || 'Document', id: d.id, number: d.document_number, title: d.document_title });
    depts.add(d.department);
  }

  if (docRecord.change_control_id) {
    try {
      const ccSnap = await getDoc(doc(getFirebaseFirestore(), CIA_COLLECTIONS.changeControls, docRecord.change_control_id));
      if (ccSnap.exists()) {
        const cc = ccSnap.data();
        deps.push({
          type: 'Change Control', id: ccSnap.id,
          number: String(cc.change_control_number || ''), title: String(cc.change_title || ''),
        });
      }
    } catch { /* skip */ }
  }

  return { dependencies: deps, affected_departments: Array.from(depts) };
}

async function hasOpenAssessment(documentId: string): Promise<boolean> {
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), CIA_COLLECTIONS.assessments),
    where('related_document_id', '==', documentId),
    limit(10),
  ));
  return snap.docs.some((d) => {
    const data = d.data();
    if (data.module && data.module !== CIA_MODULE_TAG) return false;
    return !['Approved', 'Closed', 'Cancelled', 'Rejected'].includes(String(data.assessment_status || data.status));
  });
}

export async function syncAssessmentsFromDocumentChanges(): Promise<number> {
  const docs = await listDocuments();
  const candidates = docs.filter((d) =>
    ['approved', 'under_review', 'draft'].includes(d.status) &&
    (d.reason_for_revision || d.parent_document_id),
  );
  let created = 0;

  for (const d of candidates) {
    const isMajor = !d.version.includes('.') || parseInt(d.version.split('.')[1] || '0', 10) === 0;
    if (!isMajor && d.document_type !== 'SOP') continue;
    if (await hasOpenAssessment(d.id)) continue;

    const assessmentNumber = await generateAssessmentNumber();
    const { dependencies, affected_departments } = await analyzeDocumentDependencies(d.id);
    const timestamp = now();

    await addDoc(collection(getFirebaseFirestore(), CIA_COLLECTIONS.assessments), {
      impact_assessment_id: assessmentNumber,
      assessment_number: assessmentNumber,
      module: CIA_MODULE_TAG,
      related_change_control_id: d.change_control_id || null,
      related_document_id: d.id,
      document_id: d.id,
      document_number: d.document_number,
      document_title: d.document_title,
      document_version: d.version,
      assessment_type: d.parent_document_id ? 'Major Change' : 'Document Revision',
      assessment_reason: d.reason_for_revision || 'Major document revision requires impact assessment',
      change_summary: d.reason_for_revision || '',
      business_justification: '',
      department: d.department,
      business_unit: '',
      site: '',
      product_impact: 'Medium',
      process_impact: 'Medium',
      equipment_impact: 'None',
      facility_impact: 'None',
      validation_impact: d.document_type === 'Validation Document' ? 'High' : 'Low',
      qualification_impact: 'Low',
      csv_impact: d.document_type.includes('CSV') ? 'High' : 'None',
      training_impact: d.training_required ? 'High' : 'Low',
      regulatory_impact: 'Medium',
      customer_impact: 'None',
      supplier_impact: 'None',
      material_impact: 'None',
      risk_assessment_required: isMajor,
      capa_required: false,
      revalidation_required: d.document_type === 'Validation Document',
      retraining_required: d.training_required,
      regulatory_notification_required: false,
      effective_date_impact: d.effective_date,
      priority: isMajor ? 'High' : 'Normal',
      overall_impact_rating: isMajor ? 'High' : 'Medium',
      assessment_status: 'Draft',
      reviewer_id: '',
      reviewer_name: '',
      approver_id: '',
      approver_name: '',
      electronic_signature_required: isMajor,
      dependencies,
      affected_departments,
      linked_risk_assessment_id: null,
      linked_capa_id: null,
      linked_validation_id: null,
      created_by: 'system',
      created_by_name: 'System',
      updated_by: 'system',
      updated_by_name: 'System',
      created_at: timestamp,
      updated_at: timestamp,
    });
    created++;
  }
  return created;
}

export async function createImpactAssessment(input: CreateImpactAssessmentInput, actor: ChangeImpactActor): Promise<DocumentChangeImpactRecord> {
  const docRecord = await getDocumentById(input.related_document_id);
  if (!docRecord) throw new Error('Document not found');
  if (await hasOpenAssessment(input.related_document_id)) {
    throw new Error('An open impact assessment already exists for this document');
  }

  let changeControlId = input.related_change_control_id || docRecord.change_control_id;
  if (!changeControlId) {
    changeControlId = await createLinkedChangeControl(docRecord, input, actor);
  }

  const { dependencies, affected_departments } = await analyzeDocumentDependencies(input.related_document_id);
  const assessmentNumber = await generateAssessmentNumber();
  const timestamp = now();

  const payload = {
    impact_assessment_id: assessmentNumber,
    assessment_number: assessmentNumber,
    module: CIA_MODULE_TAG,
    related_change_control_id: changeControlId,
    change_id: changeControlId,
    related_document_id: docRecord.id,
    document_id: docRecord.id,
    document_number: docRecord.document_number,
    document_title: docRecord.document_title,
    document_version: docRecord.version,
    assessment_type: input.assessment_type,
    assessment_reason: input.assessment_reason,
    change_summary: input.change_summary,
    business_justification: input.business_justification,
    department: input.department,
    site: input.site,
    business_unit: input.business_unit,
    product_impact: input.product_impact,
    process_impact: input.process_impact,
    equipment_impact: input.equipment_impact,
    facility_impact: input.facility_impact,
    validation_impact: input.validation_impact,
    qualification_impact: input.qualification_impact,
    csv_impact: input.csv_impact,
    training_impact: input.training_impact,
    regulatory_impact: input.regulatory_impact,
    customer_impact: input.customer_impact,
    supplier_impact: input.supplier_impact,
    material_impact: input.material_impact,
    risk_assessment_required: input.risk_assessment_required,
    capa_required: input.capa_required,
    revalidation_required: input.revalidation_required,
    retraining_required: input.retraining_required,
    regulatory_notification_required: input.regulatory_notification_required,
    effective_date_impact: input.effective_date_impact,
    priority: input.priority,
    overall_impact_rating: input.overall_impact_rating,
    reviewer_id: input.reviewer_id,
    reviewer_name: input.reviewer_name,
    approver_id: input.approver_id,
    approver_name: input.approver_name,
    electronic_signature_required: input.electronic_signature_required,
    dependencies,
    affected_departments,
    assessment_status: 'Draft',
    linked_risk_assessment_id: null,
    linked_capa_id: null,
    linked_validation_id: null,
    created_by: actor.id,
    created_by_name: actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const ref = await addDoc(collection(getFirebaseFirestore(), CIA_COLLECTIONS.assessments), payload);
  await audit(actor, 'ASSESSMENT_CREATED', ref.id, null, payload);
  await notify('Assessment Assigned', `${docRecord.document_number} impact assessment created`, ref.id, ['qa_manager']);
  return mapChangeImpactRaw({ id: ref.id, ...payload });
}

async function createLinkedChangeControl(
  docRecord: Awaited<ReturnType<typeof getDocumentById>>,
  input: CreateImpactAssessmentInput,
  actor: ChangeImpactActor,
): Promise<string> {
  const ccNumber = await generateChangeNumber();
  const timestamp = now();
  const ref = await addDoc(collection(getFirebaseFirestore(), CIA_COLLECTIONS.changeControls), {
    change_control_number: ccNumber,
    change_title: `Document change — ${docRecord!.document_number}`,
    change_description: input.change_summary,
    change_date: new Date().toISOString().split('T')[0],
    department: input.department,
    initiated_by: actor.id,
    initiated_by_name: actor.name,
    change_type: 'Document Change',
    change_category: input.assessment_type.includes('Major') ? 'Major' : 'Minor',
    change_priority: input.priority,
    temporary_permanent: 'Permanent',
    affected_documents: docRecord!.document_number,
    status: 'draft',
    source_module: CIA_MODULE_TAG,
    document_id: docRecord!.id,
    created_at: timestamp,
    updated_at: timestamp,
  });
  await updateDoc(doc(getFirebaseFirestore(), CIA_COLLECTIONS.documents, docRecord!.id), {
    change_control_id: ref.id, change_control_ref: ccNumber, updated_at: timestamp,
  });
  return ref.id;
}

export async function submitForReview(assessmentId: string, actor: ChangeImpactActor): Promise<void> {
  const rec = await getImpactAssessmentById(assessmentId);
  if (!rec) throw new Error('Assessment not found');
  if (!rec.assessment_reason || !rec.overall_impact_rating) {
    throw new Error('Assessment reason and overall impact rating are required');
  }
  await updateDoc(doc(getFirebaseFirestore(), CIA_COLLECTIONS.assessments, assessmentId), {
    assessment_status: 'In Review', updated_at: now(),
    updated_by: actor.id, updated_by_name: actor.name,
  });
  await audit(actor, 'REVIEW_STARTED', assessmentId, rec.assessment_status, 'In Review');
  await notify('Review Required', `${rec.document_number} impact assessment submitted for review`, assessmentId, ['qa_manager']);
}

export async function completeReview(assessmentId: string, actor: ChangeImpactActor): Promise<void> {
  const rec = await getImpactAssessmentById(assessmentId);
  if (!rec) throw new Error('Assessment not found');
  const { dependencies, affected_departments } = await analyzeDocumentDependencies(rec.related_document_id);
  await updateDoc(doc(getFirebaseFirestore(), CIA_COLLECTIONS.assessments, assessmentId), {
    assessment_status: 'Pending Approval',
    dependencies,
    affected_departments,
    updated_at: now(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  });
  await audit(actor, 'DEPENDENCY_ANALYSIS_COMPLETED', assessmentId, null, { dependencies, affected_departments });
  await audit(actor, 'REVIEW_COMPLETED', assessmentId, 'In Review', 'Pending Approval');
  await notify('Approval Pending', `${rec.document_number} awaiting approval`, assessmentId, ['head_qa']);
}

export async function approveImpactAssessment(assessmentId: string, input: ApproveImpactInput, actor: ChangeImpactActor): Promise<void> {
  const rec = await getImpactAssessmentById(assessmentId);
  if (!rec) throw new Error('Assessment not found');
  if (rec.electronic_signature_required && !input.signature_meaning?.trim()) {
    throw new Error('Electronic signature required for approval');
  }

  const updates: Record<string, string | null> = {
    assessment_status: 'Approved',
    updated_at: now(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };

  if (rec.risk_assessment_required) {
    updates.linked_risk_assessment_id = await createLinkedRisk(rec, actor);
  }
  if (rec.capa_required) {
    updates.linked_capa_id = await createLinkedCapa(rec, actor);
  }
  if (rec.revalidation_required) {
    updates.linked_validation_id = await createLinkedValidation(rec, actor);
  }

  await updateDoc(doc(getFirebaseFirestore(), CIA_COLLECTIONS.assessments, assessmentId), updates);

  if (rec.retraining_required) {
    await audit(actor, 'TRAINING_ASSIGNED', assessmentId, null, { document_id: rec.related_document_id });
    await notify('Retraining Required', `${rec.document_number} marked for retraining`, assessmentId, ['qa_manager', 'document_controller']);
  }

  if (input.signature_meaning) {
    await audit(actor, 'ELECTRONIC_SIGNATURE_COMPLETED', assessmentId, null, { meaning: input.signature_meaning });
  }
  await audit(actor, 'APPROVED', assessmentId, rec.assessment_status, 'Approved', input.comments);
  await notify('Assessment Approved', `${rec.document_number} impact assessment approved`, assessmentId, ['qa_manager']);
}

export async function rejectImpactAssessment(assessmentId: string, input: RejectImpactInput, actor: ChangeImpactActor): Promise<void> {
  const rec = await getImpactAssessmentById(assessmentId);
  if (!rec) throw new Error('Assessment not found');
  await updateDoc(doc(getFirebaseFirestore(), CIA_COLLECTIONS.assessments, assessmentId), {
    assessment_status: 'Rejected',
    rejection_reason: input.reason,
    updated_at: now(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  });
  await audit(actor, 'REJECTED', assessmentId, rec.assessment_status, 'Rejected', input.reason);
}

async function createLinkedRisk(rec: DocumentChangeImpactRecord, actor: ChangeImpactActor): Promise<string> {
  const ref = await addDoc(collection(getFirebaseFirestore(), CIA_COLLECTIONS.riskAssessments), {
    title: `Risk — ${rec.document_number}`,
    source: CIA_MODULE_TAG,
    source_reference: rec.assessment_number,
    document_id: rec.related_document_id,
    status: 'draft',
    change_impact_id: rec.id,
    created_at: now(),
    updated_at: now(),
  });
  await audit(actor, 'RISK_ASSESSMENT_CREATED', rec.id, null, { risk_id: ref.id });
  await notify('Risk Assessment Created', `Risk assessment for ${rec.document_number}`, ref.id, ['qa_manager']);
  return ref.id;
}

async function createLinkedCapa(rec: DocumentChangeImpactRecord, actor: ChangeImpactActor): Promise<string> {
  const year = new Date().getFullYear();
  const ref = await addDoc(collection(getFirebaseFirestore(), CIA_COLLECTIONS.capa), {
    capa_number: `CAPA/${year}/CIA-${rec.assessment_number}`,
    capa_date: new Date().toISOString().split('T')[0],
    capa_source: 'Change Impact Assessment',
    source_reference_number: rec.assessment_number,
    department: rec.department,
    capa_title: `CAPA from impact assessment — ${rec.document_number}`,
    problem_description: rec.change_summary,
    capa_status: 'draft',
    change_impact_id: rec.id,
    created_at: now(),
    updated_at: now(),
  });
  await audit(actor, 'CAPA_CREATED', rec.id, null, { capa_id: ref.id });
  await notify('CAPA Created', `CAPA linked to ${rec.assessment_number}`, ref.id, ['qa_manager']);
  return ref.id;
}

async function createLinkedValidation(rec: DocumentChangeImpactRecord, actor: ChangeImpactActor): Promise<string> {
  const ref = await addDoc(collection(getFirebaseFirestore(), CIA_COLLECTIONS.validationAssessments), {
    title: `Validation — ${rec.document_number}`,
    source: CIA_MODULE_TAG,
    document_id: rec.related_document_id,
    status: 'draft',
    change_impact_id: rec.id,
    created_at: now(),
    updated_at: now(),
  });
  await audit(actor, 'VALIDATION_INITIATED', rec.id, null, { validation_id: ref.id });
  await notify('Validation Required', `Validation initiated for ${rec.document_number}`, ref.id, ['qa_manager']);
  return ref.id;
}

export async function closeImpactAssessment(assessmentId: string, actor: ChangeImpactActor): Promise<void> {
  const rec = await getImpactAssessmentById(assessmentId);
  if (!rec) throw new Error('Assessment not found');
  if (rec.assessment_status !== 'Approved') throw new Error('Only approved assessments can be closed');
  await updateDoc(doc(getFirebaseFirestore(), CIA_COLLECTIONS.assessments, assessmentId), {
    assessment_status: 'Closed', updated_at: now(),
    updated_by: actor.id, updated_by_name: actor.name,
  });
  await audit(actor, 'ASSESSMENT_CLOSED', assessmentId, 'Approved', 'Closed');
}

export async function bulkCreateAssessments(documentIds: string[], actor: ChangeImpactActor): Promise<number> {
  let count = 0;
  for (const docId of documentIds) {
    const d = await getDocumentById(docId);
    if (!d || await hasOpenAssessment(docId)) continue;
    try {
      const overall = 'Medium';
      await createImpactAssessment({
        related_document_id: docId,
        related_change_control_id: d.change_control_id || '',
        assessment_type: 'Document Revision',
        assessment_reason: 'Bulk impact assessment for document revision',
        change_summary: d.reason_for_revision || 'Document revision',
        business_justification: 'Regulatory requirement for change impact assessment',
        department: d.department,
        site: '', business_unit: '', priority: 'Normal',
        product_impact: 'Low', process_impact: 'Low', equipment_impact: 'None',
        facility_impact: 'None', validation_impact: 'Low', qualification_impact: 'None',
        csv_impact: 'None', training_impact: d.training_required ? 'High' : 'Low',
        regulatory_impact: 'Medium', customer_impact: 'None', supplier_impact: 'None',
        material_impact: 'None',
        overall_impact_rating: overall,
        reviewer_id: actor.id, reviewer_name: actor.name,
        approver_id: actor.id, approver_name: actor.name,
        retraining_required: d.training_required,
        revalidation_required: false,
        risk_assessment_required: false,
        capa_required: false,
        regulatory_notification_required: false,
        electronic_signature_required: false,
      }, actor);
      count++;
    } catch { /* skip */ }
  }
  return count;
}

export async function processScheduledImpactJobs(actor: ChangeImpactActor): Promise<{ synced: number }> {
  const synced = await syncAssessmentsFromDocumentChanges();
  return { synced };
}

export async function fetchChangeImpactDashboardData(filters?: ChangeImpactFilters) {
  await processScheduledImpactJobs({ id: 'system', name: 'System', role: 'system' });
  let records = await listDmsImpactAssessments();
  if (filters) records = filterChangeImpactRecords(records, filters);
  return {
    records,
    metrics: computeChangeImpactKpis(records),
    charts: computeChangeImpactCharts(records),
  };
}

export async function getImpactAssessmentById(id: string): Promise<DocumentChangeImpactRecord | null> {
  const snap = await getDoc(doc(getFirebaseFirestore(), CIA_COLLECTIONS.assessments, id));
  if (!snap.exists()) return null;
  const rec = mapChangeImpactRaw({ id: snap.id, ...snap.data() });
  return isDmsChangeImpactRecord(rec) ? rec : null;
}

export function exportImpactAssessmentsCsv(records: DocumentChangeImpactRecord[]) {
  downloadCsv('change-impact-assessments.csv',
    ['Assessment #', 'Document', 'Version', 'Type', 'Impact', 'Status', 'Department'],
    records.map((r) => [
      r.assessment_number, r.document_number, r.document_version, r.assessment_type,
      r.overall_impact_rating, r.assessment_status, r.department,
    ]),
  );
}

export function exportImpactAssessmentsExcel(records: DocumentChangeImpactRecord[]) { exportImpactAssessmentsCsv(records); }

export async function logChangeImpactDashboardViewed(actor: ChangeImpactActor) {
  await audit(actor, 'DASHBOARD_VIEWED', 'change-impact-dashboard', null, null);
}

export async function logChangeImpactExported(actor: ChangeImpactActor, format: string, count: number) {
  await audit(actor, 'EXPORT', 'change-impact-dashboard', null, { format, count });
}

export async function runScheduledChangeImpactJobs() {
  return processScheduledImpactJobs({ id: 'scheduler', name: 'Scheduled Job', role: 'system' });
}

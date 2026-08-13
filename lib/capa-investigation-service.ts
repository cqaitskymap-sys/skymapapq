import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  canApproveCriticalCapaInvestigation,
  CAPA_INVESTIGATION_MODULE,
  computeInvestigationAutoRules,
  computeInvestigationDashboardMetrics,
  computeRcaAutoRecommendations,
  emptyFishbone,
  emptyFiveWhy,
  isInvestigationApproved,
  type CapaInvestigationActor,
  type CapaInvestigationFormInput,
  type CapaInvestigationQaReviewInput,
} from '@/lib/capa-investigation-records';
import { getCapaById, updateCapa } from '@/lib/capa-service';
import {
  CAPA_COLLECTIONS,
  type CapaInvestigation,
  type CapaInvestigationDashboardMetrics,
  type CapaRecord,
  type CapaRootCauseAnalysis,
} from '@/lib/capa-types';

export type {
  CapaInvestigationActor,
  CapaInvestigationFormInput,
  CapaInvestigationQaReviewInput,
};

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

async function audit(
  actor: CapaInvestigationActor,
  actionType: string,
  capaId: string,
  detail?: string,
) {
  try {
    await createAuditLog({
      moduleName: CAPA_INVESTIGATION_MODULE,
      collectionName: CAPA_COLLECTIONS.investigations,
      recordId: capaId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('capa investigation audit', e);
  }
}

async function notify(title: string, message: string, capaId: string, userId: string) {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
      title,
      message,
      module: 'CAPA Investigation',
      record_id: capaId,
      user_id: userId,
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('capa investigation notify', e);
  }
}

export async function generateInvestigationId(): Promise<string> {
  const year = new Date().getFullYear();
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  try {
    const prefix = `INV-CAPA/${year}/`;
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.investigations),
      where('investigation_id', '>=', prefix),
      where('investigation_id', '<=', `${prefix}\uf8ff`),
      orderBy('investigation_id', 'desc'),
      limit(1),
    ));
    if (!snap.empty) {
      const last = String(snap.docs[0].data().investigation_id || '');
      const seq = parseInt(last.split('/').pop() || '0', 10) + 1;
      return `INV-CAPA/${year}/${String(seq).padStart(4, '0')}`;
    }
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.investigations));
      return `INV-CAPA/${year}/${String(snap.size + 1).padStart(4, '0')}`;
    } catch {
      throw new Error('Unable to generate investigation ID from backend.');
    }
  }
  throw new Error('Unable to generate investigation ID from backend.');
}

export async function getCapaInvestigationByCapaId(capaId: string): Promise<CapaInvestigation | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.investigations),
      where('capa_id', '==', capaId),
      where('is_deleted', '==', false),
      limit(1),
    ));
    if (snap.empty) {
      const fallback = await getDocs(query(
        collection(getFirebaseFirestore(), CAPA_COLLECTIONS.investigations),
        where('capa_id', '==', capaId),
        limit(1),
      ));
      if (fallback.empty) return null;
      const data = fallback.docs[0].data();
      if (data.is_deleted) return null;
      return { id: fallback.docs[0].id, ...data } as CapaInvestigation;
    }
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as CapaInvestigation;
  } catch (e) {
    console.error('getCapaInvestigationByCapaId', e);
    return null;
  }
}

export async function getCapaRootCauseAnalysis(capaId: string): Promise<CapaRootCauseAnalysis | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.rootCauseAnalysis),
      where('capa_id', '==', capaId),
      where('is_deleted', '==', false),
      orderBy('updated_at', 'desc'),
      limit(1),
    ));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as CapaRootCauseAnalysis;
  } catch (e) {
    console.error('getCapaRootCauseAnalysis', e);
    return null;
  }
}

export async function listCapaInvestigations(max = 200): Promise<(CapaInvestigation & { capa?: CapaRecord | null })[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.investigations),
      orderBy('updated_at', 'desc'),
      limit(max),
    ));
    const investigations = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as CapaInvestigation))
      .filter((i) => !i.is_deleted);

    return Promise.all(investigations.map(async (inv) => ({
      ...inv,
      capa: await getCapaById(inv.capa_id),
    })));
  } catch (e) {
    console.error('listCapaInvestigations', e);
    return [];
  }
}

export async function fetchCapaInvestigationDashboard(): Promise<{
  investigations: (CapaInvestigation & { capa?: CapaRecord | null })[];
  metrics: CapaInvestigationDashboardMetrics;
  error?: string;
}> {
  if (!isFirebaseConfigured()) {
    return { investigations: [], metrics: computeInvestigationDashboardMetrics([]), error: 'Firebase is not configured.' };
  }
  try {
    const investigations = await listCapaInvestigations();
    return {
      investigations,
      metrics: computeInvestigationDashboardMetrics(investigations),
    };
  } catch (e) {
    return {
      investigations: [],
      metrics: computeInvestigationDashboardMetrics([]),
      error: e instanceof Error ? e.message : 'Failed to load investigations',
    };
  }
}

export async function fetchCapaInvestigationPageData(capaId: string) {
  if (!isFirebaseConfigured()) {
    return { error: 'Firebase is not configured.' };
  }
  try {
    const [capa, investigation, rca, auditLogs] = await Promise.all([
      getCapaById(capaId),
      getCapaInvestigationByCapaId(capaId),
      getCapaRootCauseAnalysis(capaId),
      getAuditLogsForCapaInvestigation(capaId),
    ]);
    if (!capa) return { error: 'CAPA record not found.' };
    return { capa, investigation, rca, auditLogs };
  } catch (e) {
    console.error('fetchCapaInvestigationPageData', e);
    return { error: e instanceof Error ? e.message : 'Failed to load investigation' };
  }
}

export async function getAuditLogsForCapaInvestigation(capaId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.auditLogs),
      where('recordId', '==', capaId),
      limit(100),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

function mergeFiveWhy(input?: Partial<CapaInvestigation['five_why']>): CapaInvestigation['five_why'] {
  return { ...emptyFiveWhy(), ...(input || {}) };
}

function mergeFishbone(input?: Partial<CapaInvestigation['fishbone']>): CapaInvestigation['fishbone'] {
  return { ...emptyFishbone(), ...(input || {}) };
}

function buildInvestigationPayload(
  capa: CapaRecord,
  input: CapaInvestigationFormInput,
  actor: CapaInvestigationActor,
  status: string,
  existing?: CapaInvestigation | null,
  investigationId?: string,
): Omit<CapaInvestigation, 'id'> {
  const ts = nowIso();
  const autoRecs = [
    ...computeRcaAutoRecommendations(input.root_cause_category),
    ...(computeInvestigationAutoRules(input, capa).recommendations),
  ];
  const uniqueRecs = Array.from(new Set(autoRecs));

  return {
    investigation_id: existing?.investigation_id || investigationId || '',
    capa_id: capa.id,
    capa_number: capa.capa_number,
    source_type: capa.capa_source,
    source_reference: capa.source_reference_number,
    investigation_date: input.investigation_date || today(),
    investigator: input.investigator,
    investigator_name: input.investigator_name || actor.name,
    department: input.department,
    problem_statement: input.problem_statement,
    observed_issue: input.observed_issue || '',
    issue_description: input.issue_description || '',
    immediate_containment_action: input.immediate_containment_action || '',
    root_cause_method: input.root_cause_method,
    root_cause_category: input.root_cause_category,
    root_cause_description: input.root_cause_description,
    contributing_factors: input.contributing_factors || '',
    evidence_summary: input.evidence_summary || '',
    evidence_items: existing?.evidence_items || [],
    risk_assessment_result: input.risk_assessment_result || '',
    corrective_action_recommendation: input.corrective_action_recommendation || '',
    preventive_action_recommendation: input.preventive_action_recommendation || '',
    investigation_conclusion: input.investigation_conclusion,
    qa_review_comments: existing?.qa_review_comments || '',
    five_why: mergeFiveWhy(input.five_why),
    fishbone: mergeFishbone(input.fishbone),
    auto_recommendations: uniqueRecs,
    status,
    is_deleted: false,
    created_at: existing?.created_at || ts,
    updated_at: ts,
    created_by: existing?.created_by || actor.id,
    created_by_name: existing?.created_by_name || actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
}

async function syncRootCauseAnalysisDoc(
  investigation: CapaInvestigation,
  actor: CapaInvestigationActor,
  existingRca?: CapaRootCauseAnalysis | null,
) {
  if (!isFirebaseConfigured()) return;
  const ts = nowIso();
  const payload: Omit<CapaRootCauseAnalysis, 'id'> = {
    investigation_id: investigation.investigation_id,
    capa_id: investigation.capa_id,
    capa_number: investigation.capa_number,
    root_cause_method: investigation.root_cause_method,
    root_cause_category: investigation.root_cause_category,
    root_cause_description: investigation.root_cause_description,
    contributing_factors: investigation.contributing_factors,
    five_why: investigation.five_why,
    fishbone: investigation.fishbone,
    auto_recommendations: investigation.auto_recommendations,
    status: investigation.status,
    is_deleted: false,
    created_at: existingRca?.created_at || ts,
    updated_at: ts,
    created_by: existingRca?.created_by || actor.id,
    created_by_name: existingRca?.created_by_name || actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };

  if (existingRca?.id) {
    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.rootCauseAnalysis, existingRca.id), payload);
  } else {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.rootCauseAnalysis), payload);
  }
}

async function upsertInvestigation(
  capa: CapaRecord,
  input: CapaInvestigationFormInput,
  actor: CapaInvestigationActor,
  status: string,
  auditAction: string,
): Promise<CapaInvestigation> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');

  const existing = await getCapaInvestigationByCapaId(capa.id);
  const existingRca = await getCapaRootCauseAnalysis(capa.id);
  const investigationId = existing?.investigation_id || await generateInvestigationId();
  const payload = buildInvestigationPayload(capa, input, actor, status, existing, investigationId);

  let saved: CapaInvestigation;
  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.investigations, existing.id), payload);
    saved = { id: existing.id, ...payload };
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.investigations), payload);
    saved = { id: ref.id, ...payload };
    await audit(actor, 'INVESTIGATION_CREATED', capa.id, `Investigation ${investigationId} created for ${capa.capa_number}`);
  }

  await syncRootCauseAnalysisDoc(saved, actor, existingRca);
  await audit(actor, auditAction, capa.id, auditAction);
  return saved;
}

export async function saveCapaInvestigationDraft(
  input: CapaInvestigationFormInput,
  actor: CapaInvestigationActor,
): Promise<CapaInvestigation> {
  const capa = await getCapaById(input.capa_id);
  if (!capa) throw new Error('CAPA not found');
  return upsertInvestigation(capa, input, actor, 'draft', 'INVESTIGATION_DRAFT_SAVED');
}

export async function startCapaInvestigation(
  input: CapaInvestigationFormInput,
  actor: CapaInvestigationActor,
): Promise<CapaInvestigation> {
  const capa = await getCapaById(input.capa_id);
  if (!capa) throw new Error('CAPA not found');
  const saved = await upsertInvestigation(capa, input, actor, 'under_investigation', 'INVESTIGATION_STARTED');
  await notify(
    'CAPA Investigation Started',
    `Investigation started for CAPA ${capa.capa_number}`,
    capa.id,
    capa.qa_reviewer || capa.created_by,
  );
  return saved;
}

export async function updateCapaFiveWhy(
  capaId: string,
  fiveWhy: CapaInvestigation['five_why'],
  actor: CapaInvestigationActor,
): Promise<CapaInvestigation> {
  const capa = await getCapaById(capaId);
  if (!capa) throw new Error('CAPA not found');
  const existing = await getCapaInvestigationByCapaId(capaId);
  const base = existing
    ? mapExistingToForm(existing, capa)
    : {
      capa_id: capaId,
      investigation_date: today(),
      investigator: actor.id,
      investigator_name: actor.name,
      department: capa.department,
      problem_statement: capa.problem_description,
      root_cause_method: '5 Why Analysis',
      root_cause_category: 'Process',
      root_cause_description: capa.root_cause || fiveWhy.final_root_cause || '',
      investigation_conclusion: '',
    } as CapaInvestigationFormInput;

  const saved = await upsertInvestigation(
    capa,
    { ...base, five_why: fiveWhy, root_cause_description: fiveWhy.final_root_cause || base.root_cause_description },
    actor,
    existing?.status || 'under_investigation',
    'FIVE_WHY_UPDATED',
  );
  return saved;
}

export async function updateCapaFishbone(
  capaId: string,
  fishbone: CapaInvestigation['fishbone'],
  actor: CapaInvestigationActor,
): Promise<CapaInvestigation> {
  const capa = await getCapaById(capaId);
  if (!capa) throw new Error('CAPA not found');
  const existing = await getCapaInvestigationByCapaId(capaId);
  const base = existing ? mapExistingToForm(existing, capa) : {
    capa_id: capaId,
    investigation_date: today(),
    investigator: actor.id,
    investigator_name: actor.name,
    department: capa.department,
    problem_statement: capa.problem_description,
    root_cause_method: 'Fishbone Diagram',
    root_cause_category: 'Process',
    root_cause_description: capa.root_cause || '',
    investigation_conclusion: '',
    fishbone,
  } as CapaInvestigationFormInput;

  const saved = await upsertInvestigation(
    capa,
    { ...base, fishbone, root_cause_method: 'Fishbone Diagram' },
    actor,
    existing?.status || 'under_investigation',
    'FISHBONE_UPDATED',
  );
  return saved;
}

function mapExistingToForm(inv: CapaInvestigation, capa: CapaRecord): CapaInvestigationFormInput {
  return {
    capa_id: capa.id,
    investigation_date: inv.investigation_date,
    investigator: inv.investigator,
    investigator_name: inv.investigator_name,
    department: inv.department,
    problem_statement: inv.problem_statement,
    observed_issue: inv.observed_issue,
    issue_description: inv.issue_description,
    immediate_containment_action: inv.immediate_containment_action,
    root_cause_method: inv.root_cause_method,
    root_cause_category: inv.root_cause_category,
    root_cause_description: inv.root_cause_description,
    contributing_factors: inv.contributing_factors,
    evidence_summary: inv.evidence_summary,
    risk_assessment_result: inv.risk_assessment_result,
    corrective_action_recommendation: inv.corrective_action_recommendation,
    preventive_action_recommendation: inv.preventive_action_recommendation,
    investigation_conclusion: inv.investigation_conclusion,
    five_why: inv.five_why,
    fishbone: inv.fishbone,
  };
}

export async function addCapaInvestigationEvidence(
  capaId: string,
  evidence: { name: string; description: string; file_url?: string },
  actor: CapaInvestigationActor,
): Promise<CapaInvestigation> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const existing = await getCapaInvestigationByCapaId(capaId);
  const capa = await getCapaById(capaId);
  if (!capa) throw new Error('CAPA not found');
  if (!existing) throw new Error('Start investigation before adding evidence');

  const item = {
    id: `ev-${Date.now()}`,
    name: evidence.name,
    description: evidence.description,
    file_url: evidence.file_url || '',
    added_at: nowIso(),
    added_by: actor.id,
    added_by_name: actor.name,
  };
  const evidenceItems = [...(existing.evidence_items || []), item];
  const summary = existing.evidence_summary
    ? `${existing.evidence_summary}\n- ${item.name}: ${item.description}`
    : `- ${item.name}: ${item.description}`;

  const payload = {
    evidence_items: evidenceItems,
    evidence_summary: summary,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.investigations, existing.id), payload);
  await audit(actor, 'EVIDENCE_ADDED', capaId, item.name);
  await notify('CAPA Investigation Evidence', `Evidence added to ${capa.capa_number}: ${item.name}`, capaId, capa.qa_reviewer || capa.created_by);
  return { ...existing, ...payload };
}

export async function submitCapaInvestigationForQaReview(
  input: CapaInvestigationFormInput,
  actor: CapaInvestigationActor,
): Promise<CapaInvestigation> {
  const capa = await getCapaById(input.capa_id);
  if (!capa) throw new Error('CAPA not found');
  const saved = await upsertInvestigation(capa, input, actor, 'qa_review', 'INVESTIGATION_QA_SUBMITTED');

  await notify('CAPA Investigation QA Review', `RCA submitted for QA review — ${capa.capa_number}`, capa.id, capa.qa_reviewer || capa.created_by);
  await notify('CAPA Investigation Pending Review', `Investigation pending QA review for ${capa.capa_number}`, capa.id, capa.action_owner);
  await notify(
    'CAPA Investigation — Department Review',
    `RCA for ${capa.capa_number} (${capa.department}) submitted for review`,
    capa.id,
    capa.created_by,
  );

  const auto = computeInvestigationAutoRules(input, capa);
  if (auto.notifyHeadQa) {
    await notify('Critical CAPA RCA Review', `Critical CAPA ${capa.capa_number} RCA requires Head QA review`, capa.id, 'head_qa');
  }
  return saved;
}

export async function reviewCapaInvestigation(
  capaId: string,
  review: CapaInvestigationQaReviewInput,
  actor: CapaInvestigationActor,
): Promise<CapaInvestigation> {
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  const capa = await getCapaById(capaId);
  if (!capa) throw new Error('CAPA not found');
  const existing = await getCapaInvestigationByCapaId(capaId);
  if (!existing) throw new Error('Investigation not found');

  if (!canApproveCriticalCapaInvestigation(actor.role, capa.priority)) {
    throw new Error('Head QA approval required for critical CAPA RCA');
  }

  const status = review.decision === 'approved' ? 'approved' : 'rejected';
  const ts = nowIso();
  const payload = {
    status,
    qa_review_comments: review.qa_review_comments,
    updated_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };

  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.investigations, existing.id), payload);
  const saved = { ...existing, ...payload };
  await syncRootCauseAnalysisDoc(saved, actor, await getCapaRootCauseAnalysis(capaId));

  if (review.decision === 'approved') {
    await updateCapa(capaId, {
      root_cause: existing.root_cause_description || existing.five_why?.final_root_cause || capa.root_cause,
      corrective_action: existing.corrective_action_recommendation || capa.corrective_action,
      preventive_action: existing.preventive_action_recommendation || capa.preventive_action,
      capa_status: capa.capa_status === 'submitted' || capa.capa_status === 'assigned' ? 'assigned' : capa.capa_status,
    }, { id: actor.id, name: actor.name, role: actor.role || '' }, { workflow: true });

    await audit(actor, 'INVESTIGATION_APPROVED', capaId, review.qa_review_comments);
    await notify('CAPA Investigation Approved', `RCA approved for ${capa.capa_number}`, capaId, capa.action_owner);
  } else {
    await audit(actor, 'INVESTIGATION_REJECTED', capaId, review.qa_review_comments);
    await notify('CAPA Investigation Rejected', `RCA rejected for ${capa.capa_number}`, capaId, capa.action_owner);
  }

  await notify('CAPA Investigation QA Review Completed', `QA ${review.decision} investigation for ${capa.capa_number}`, capaId, capa.created_by);
  return saved;
}

export async function closeCapaInvestigation(
  capaId: string,
  actor: CapaInvestigationActor,
): Promise<CapaInvestigation> {
  const existing = await getCapaInvestigationByCapaId(capaId);
  if (!existing) throw new Error('Investigation not found');
  if (!isInvestigationApproved(existing.status)) {
    throw new Error('QA approval required before investigation closure');
  }
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');

  const payload = {
    status: 'closed',
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.investigations, existing.id), payload);
  await audit(actor, 'INVESTIGATION_CLOSED', capaId);
  return { ...existing, ...payload };
}

export async function uploadCapaInvestigationAttachmentPlaceholder(
  capaId: string,
  fileName: string,
  actor: CapaInvestigationActor,
): Promise<void> {
  await audit(actor, 'ATTACHMENT_UPLOAD_BLOCKED', capaId, fileName);
  throw new Error('CAPA investigation attachment upload backend is not implemented. Configure real file upload first.');
}

export async function assertInvestigationApprovedForCapaWorkflow(capaId: string): Promise<void> {
  const investigation = await getCapaInvestigationByCapaId(capaId);
  if (!investigation) {
    throw new Error('CAPA investigation is mandatory before proceeding. Complete RCA investigation first.');
  }
  if (!isInvestigationApproved(investigation.status)) {
    throw new Error('Approved RCA is required before CAPA implementation or approval. Complete QA review first.');
  }
  if (!investigation.root_cause_description?.trim()) {
    throw new Error('Root cause description is mandatory before CAPA implementation.');
  }
}

export { computeInvestigationDashboardMetrics };

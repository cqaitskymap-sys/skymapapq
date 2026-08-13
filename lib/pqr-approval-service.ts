import {
  collection, doc, addDoc, getDocs, getDoc, updateDoc, query, where, limit, orderBy, writeBatch,
} from 'firebase/firestore';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { buildApprovalFlow, fetchActiveMatrixForModule } from '@/lib/admin/approval-matrix-service';
import type { PqrOption } from '@/lib/pqr-batch-review-records';
import { fetchPqrOptions, fetchPqrById } from '@/lib/pqr-batch-review-service';
import {
  consolidatePqrReviewData,
  fetchSummaryConclusionRecord,
} from '@/lib/pqr-summary-conclusion-service';
import { buildApprovalReadiness, buildSectionCompletion } from '@/lib/pqr-summary-conclusion-records';
import {
  PQR_APPROVAL_COLLECTIONS,
  PQR_APPROVAL_MODULE,
  canSubmitPqrApproval,
  canActOnApproval,
  canReopenApprovedPqr,
  canReassignApproval,
  canArchivePqrApproval,
  mapWorkflowStatusForStep,
  matrixLabelToApprovalType,
  normalizeApproverRole,
  type PqrApprovalHistoryEntry,
  type PqrApprovalRecord,
  type PqrWorkflowStepDef,
} from '@/lib/pqr-approval-records';
import { canTransitionPqrStatus, normalizePqrStatus } from '@/lib/pqr-dashboard-records';

export type PqrApprovalActor = { id: string; name: string; role?: string; email?: string };

export { fetchPqrOptions, fetchPqrById };

const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));

function userSafeError(fallback: string, e?: unknown): string {
  console.error(fallback, e);
  return fallback;
}

function buildApprovalId(pqrNumber: string, level: number) {
  return `PAP-${pqrNumber.replace(/\s+/g, '-')}-L${level}-${Date.now().toString(36).toUpperCase()}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function assertActorCanSubmit(actor: PqrApprovalActor): string | null {
  if (!canSubmitPqrApproval(actor.role)) {
    return 'You are not authorized to submit this PQR for approval.';
  }
  return null;
}

async function readCollection(name: string, max = 500): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), name), orderBy('createdAt', 'desc'), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), name), limit(max)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.error(`readCollection ${name}`, e);
      return [];
    }
  }
}

async function logApprovalAudit(
  actionType: string,
  actor: PqrApprovalActor,
  detail?: unknown,
  recordId = 'pqr-approval',
) {
  try {
    await createAuditLog({
      moduleName: PQR_APPROVAL_MODULE,
      collectionName: PQR_APPROVAL_COLLECTIONS.approvals,
      recordId,
      actionType,
      newValue: detail,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: PQR_APPROVAL_COLLECTIONS.approvals,
      documentId: recordId,
      action: actionType,
      oldValue: null,
      newValue: detail,
      userId: actor.id,
      userName: actor.name,
      moduleName: PQR_APPROVAL_MODULE,
    });
  } catch (e) {
    console.error('logApprovalAudit failed', e);
  }
}

async function saveHistory(
  entry: Omit<PqrApprovalHistoryEntry, 'id'>,
  actor: PqrApprovalActor,
) {
  try {
    await addDoc(collection(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvalHistory), {
      ...entry,
      createdBy: actor.id,
      isDeleted: false,
    });
  } catch (e) {
    console.error('saveHistory failed', e);
  }
}

async function createNotification(
  userId: string,
  title: string,
  message: string,
  pqrId: string,
) {
  if (!isFirebaseConfigured() || !userId?.trim()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.notifications), {
      userId,
      title,
      message,
      module: PQR_APPROVAL_MODULE,
      recordId: pqrId,
      read: false,
      createdAt: nowIso(),
      isDeleted: false,
    });
  } catch (e) {
    console.error('createNotification failed', e);
  }
}

async function updatePqrRecordStatus(
  pqrId: string,
  updates: Record<string, unknown>,
  actor: PqrApprovalActor,
) {
  if (!isFirebaseConfigured()) return;
  const ts = nowIso();
  if (updates.status) {
    const next = normalizePqrStatus(str(updates.status));
    let from = 'Draft';
    for (const coll of [PQR_APPROVAL_COLLECTIONS.records, PQR_APPROVAL_COLLECTIONS.recordsLegacy]) {
      try {
        const snap = await getDoc(doc(getFirebaseFirestore(), coll, pqrId));
        if (snap.exists()) {
          from = normalizePqrStatus(str(snap.data()?.status || snap.data()?.document_status, 'Draft'));
          break;
        }
      } catch {
        // try next
      }
    }
    if (!canTransitionPqrStatus(from, next)) {
      throw new Error(`Invalid PQR status transition: ${from} → ${next}`);
    }
    updates.status = next;
  }
  const payload = { ...updates, updatedAt: ts, updatedBy: actor.id };
  for (const coll of [PQR_APPROVAL_COLLECTIONS.records, PQR_APPROVAL_COLLECTIONS.recordsLegacy]) {
    try {
      await updateDoc(doc(getFirebaseFirestore(), coll, pqrId), payload);
      return;
    } catch {
      // try next collection
    }
  }
}

async function lockPqrSections(pqrId: string, actor: PqrApprovalActor) {
  if (!isFirebaseConfigured()) return;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.sections),
      where('pqrId', '==', pqrId),
    ));
    const batch = writeBatch(getFirebaseFirestore());
    snap.docs.forEach((d) => {
      batch.update(d.ref, { status: 'Locked', updatedAt: nowIso(), updatedBy: actor.id });
    });
    await batch.commit();
  } catch (e) {
    console.error('lockPqrSections failed', e);
  }
}

/** Unlock sections after reopen / send-back — restore Completed or Draft, never leave Locked. */
async function unlockPqrSections(pqrId: string, actor: PqrApprovalActor) {
  if (!isFirebaseConfigured()) return;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.sections),
      where('pqrId', '==', pqrId),
    ));
    const batch = writeBatch(getFirebaseFirestore());
    const ts = nowIso();
    snap.docs.forEach((d) => {
      const data = d.data();
      const prev = str(data.status);
      const next = prev === 'Locked'
        ? (data.included === false ? 'Draft' : 'Completed')
        : (prev || 'Completed');
      batch.update(d.ref, { status: next === 'Locked' ? 'Completed' : next, updatedAt: ts, updatedBy: actor.id });
    });
    await batch.commit();
  } catch (e) {
    console.error('unlockPqrSections failed', e);
  }
}

async function cancelRemainingSteps(
  approvals: PqrApprovalRecord[],
  excludeId: string | undefined,
  status: string,
  actor: PqrApprovalActor,
) {
  if (!isFirebaseConfigured()) return;
  const ts = nowIso();
  const toCancel = approvals.filter((a) =>
    a.id
    && a.id !== excludeId
    && !a.isDeleted
    && ['Pending', 'In Review', 'Escalated'].includes(a.approvalStatus),
  );
  if (!toCancel.length) return;
  const batch = writeBatch(getFirebaseFirestore());
  toCancel.forEach((a) => {
    batch.update(doc(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals, a.id!), {
      approvalStatus: 'Cancelled',
      workflowStatus: status,
      updatedAt: ts,
      updatedBy: actor.id,
    });
  });
  await batch.commit();
}

/**
 * Resolve workflow steps from active approval matrix via buildApprovalFlow.
 * Returns an empty list when matrix/flow is not configured.
 * `pqr` kept for future product-specific matrix selection.
 */
export async function resolveWorkflowSteps(pqr: PqrOption): Promise<PqrWorkflowStepDef[]> {
  void pqr;
  try {
    const matrix = await fetchActiveMatrixForModule('PQR')
      || await fetchActiveMatrixForModule('Product Quality Review');
    if (matrix) {
      const flow = buildApprovalFlow(matrix);
      if (flow.length) {
        const eSign = matrix.eSignatureRequired !== false;
        const commentReq = matrix.approvalCommentRequired !== false;
        return flow.map((item, index) => {
          const firstRole = (item.roles || '').split(',')[0]?.trim() || 'qa_executive';
          const approverRole = normalizeApproverRole(firstRole.toLowerCase().replace(/\s+/g, '_'));
          let approvalType = matrixLabelToApprovalType(item.label);
          const isLast = index === flow.length - 1;
          if (isLast && (item.label.toLowerCase().includes('final') || approvalType === 'Final Approved By')) {
            approvalType = 'Final Approved By';
          } else if (isLast && approvalType === 'Approved By') {
            approvalType = 'Final Approved By';
          }
          return {
            level: index + 1,
            approvalType,
            approverRole,
            stepName: item.label || approvalType,
            designation: firstRole,
            dueDays: isLast || approvalType === 'Final Approved By' ? 10 : 7,
            eSignatureRequired: eSign,
            commentRequired: index === 0 ? false : commentReq,
          } satisfies PqrWorkflowStepDef;
        });
      }
    }
  } catch (e) {
    console.error('resolveWorkflowSteps matrix failed', e);
  }
  return [];
}

const REQUIRED_SECTION_GROUPS: Array<{ keys: string[]; consolidateKey: string; label: string }> = [
  { keys: ['batch_manufacturing', 'batch_review'], consolidateKey: 'batches', label: 'batch manufacturing / batch review' },
  { keys: ['material_review'], consolidateKey: 'materials', label: 'material review' },
  { keys: ['packaging_review'], consolidateKey: 'packaging', label: 'packaging review' },
  { keys: ['equipment_review'], consolidateKey: 'equipment', label: 'equipment review' },
  { keys: ['utility_environmental_review', 'utility_review'], consolidateKey: 'utility', label: 'utility / environmental review' },
  { keys: ['stability_review'], consolidateKey: 'stability', label: 'stability review' },
  { keys: ['summary_conclusion', 'summary'], consolidateKey: 'summary', label: 'summary conclusion' },
];

const READINESS_WARN_KEYS = new Set(['esign', 'critical', 'open-critical-capa']);

export async function validatePqrForSubmission(pqrId: string): Promise<{ valid: boolean; errors: string[]; warnings?: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isFirebaseConfigured()) return { valid: false, errors: ['Firebase is not configured.'] };

  try {
    const sectionsSnap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.sections),
      where('pqrId', '==', pqrId),
      where('isDeleted', '==', false),
    ));
    const sections = sectionsSnap.docs.map((d) => d.data());

    let consolidateOk = false;
    let sectionCompletion: ReturnType<typeof buildSectionCompletion> = [];
    let readiness: ReturnType<typeof buildApprovalReadiness> | null = null;
    try {
      const pqr = await fetchPqrById(pqrId);
      if (pqr) {
        const consolidated = await consolidatePqrReviewData(pqr);
        sectionCompletion = buildSectionCompletion(consolidated);
        const summary = await fetchSummaryConclusionRecord(pqrId);
        readiness = buildApprovalReadiness(consolidated, summary);
        consolidateOk = true;
      }
    } catch (e) {
      console.error('validatePqrForSubmission consolidate failed', e);
    }

    for (const group of REQUIRED_SECTION_GROUPS) {
      if (group.consolidateKey === 'summary') {
        const hasSummarySection = sections.some(
          (s) => group.keys.includes(str(s.sectionKey)) && s.included !== false,
        );
        if (!hasSummarySection) errors.push(`Required section missing: ${group.label}`);
        continue;
      }
      const hasSection = sections.some(
        (s) => group.keys.includes(str(s.sectionKey)) && s.included !== false,
      );
      const consolidateCount = sectionCompletion.find((s) => s.key === group.consolidateKey)?.recordCount ?? 0;
      if (!hasSection && consolidateCount <= 0) {
        errors.push(`Required section missing or incomplete: ${group.label}`);
      }
    }

    const summary = await fetchSummaryConclusionRecord(pqrId);
    if (!summary?.executiveSummary?.trim()) {
      let fallbackOk = false;
      for (const coll of [PQR_APPROVAL_COLLECTIONS.records, PQR_APPROVAL_COLLECTIONS.recordsLegacy]) {
        try {
          const pqrSnap = await getDoc(doc(getFirebaseFirestore(), coll, pqrId));
          if (pqrSnap.exists() && str(pqrSnap.data()?.executiveSummary).trim()) {
            fallbackOk = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (!fallbackOk) errors.push('Executive Summary is required before submission.');
    }
    if (!summary?.finalConclusion?.trim()) {
      let fallbackOk = false;
      for (const coll of [PQR_APPROVAL_COLLECTIONS.records, PQR_APPROVAL_COLLECTIONS.recordsLegacy]) {
        try {
          const pqrSnap = await getDoc(doc(getFirebaseFirestore(), coll, pqrId));
          if (pqrSnap.exists() && str(pqrSnap.data()?.conclusion).trim()) {
            fallbackOk = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (!fallbackOk) errors.push('Final Conclusion is required before submission.');
    }
    if (summary && !summary.recommendations?.trim()) {
      errors.push('Recommendations are required before submission.');
    }

    if (consolidateOk && readiness) {
      for (const item of readiness.items) {
        if (item.ok) continue;
        if (READINESS_WARN_KEYS.has(item.key)) {
          warnings.push(`${item.label}: ${item.detail}`);
        } else {
          errors.push(`${item.label}: ${item.detail}`);
        }
      }
    }

    const existing = await fetchApprovalRecords(pqrId);
    const active = existing.filter((a) => !a.isDeleted);
    if (active.some((a) => a.workflowStatus === 'Approved')) {
      errors.push('PQR is already approved.');
    }
    const inProgress = active.some((a) =>
      ['Pending', 'In Review', 'Escalated'].includes(a.approvalStatus)
      && a.workflowStatus !== 'Sent Back'
      && a.workflowStatus !== 'Returned for Correction',
    );
    if (inProgress) {
      errors.push('Approval workflow already in progress');
    }
  } catch (e) {
    errors.push(userSafeError('Unable to validate PQR for submission.', e));
  }

  return { valid: errors.length === 0, errors, warnings };
}

function stepToRecord(
  step: PqrWorkflowStepDef,
  pqr: PqrOption,
  actor: PqrApprovalActor,
  isFirst: boolean,
): Omit<PqrApprovalRecord, 'id'> {
  const ts = nowIso();
  return {
    approvalId: buildApprovalId(pqr.pqrNumber, step.level),
    pqrId: pqr.id,
    pqrNumber: pqr.pqrNumber,
    product: pqr.productName,
    productCode: pqr.productCode,
    reviewPeriodFrom: pqr.reviewPeriodFrom?.slice(0, 10) || '',
    reviewPeriodTo: pqr.reviewPeriodTo?.slice(0, 10) || '',
    currentWorkflowStep: step.stepName,
    currentApproverRole: step.approverRole,
    currentApproverUser: isFirst ? actor.id : '',
    approvalLevel: step.level,
    approvalType: step.approvalType,
    approvalStatus: isFirst ? 'In Review' : 'Pending',
    approvalComments: '',
    rejectionReason: '',
    sendBackReason: '',
    eSignatureRequired: step.eSignatureRequired,
    eSignatureStatus: isFirst
      ? (step.eSignatureRequired ? 'Required' : 'Not Required')
      : (step.eSignatureRequired ? 'Required' : 'Not Required'),
    signedBy: '',
    signedDate: '',
    dueDate: addDays(ts, step.dueDays),
    completedDate: '',
    escalationStatus: 'None',
    priority: step.level >= 7 || step.approvalType === 'Final Approved By' ? 'High' : 'Normal',
    remarks: '',
    workflowStatus: isFirst ? mapWorkflowStatusForStep(step) : 'Under Review',
    commentRequired: step.commentRequired,
    revision: 1,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdByName: actor.name,
    updatedByName: actor.name,
    isDeleted: false,
  };
}

export async function fetchApprovalRecords(pqrId: string): Promise<PqrApprovalRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals),
      where('pqrId', '==', pqrId),
      where('isDeleted', '==', false),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as PqrApprovalRecord))
      .sort((a, b) => a.approvalLevel - b.approvalLevel);
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals),
        where('pqrId', '==', pqrId),
      ));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as PqrApprovalRecord))
        .filter((r) => !r.isDeleted)
        .sort((a, b) => a.approvalLevel - b.approvalLevel);
    } catch (e) {
      console.error('fetchApprovalRecords failed', e);
      return [];
    }
  }
}

export async function fetchAllApprovalRecords(): Promise<PqrApprovalRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals),
      where('isDeleted', '==', false),
      orderBy('updatedAt', 'desc'),
      limit(500),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PqrApprovalRecord));
  } catch {
    const rows = await readCollection(PQR_APPROVAL_COLLECTIONS.approvals);
    return rows.filter((r) => !r.isDeleted).map((r) => r as unknown as PqrApprovalRecord);
  }
}

export async function fetchApprovalHistory(pqrId?: string): Promise<PqrApprovalHistoryEntry[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const q = pqrId
      ? query(collection(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvalHistory), where('pqrId', '==', pqrId), where('isDeleted', '==', false))
      : query(collection(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvalHistory), where('isDeleted', '==', false), orderBy('createdAt', 'desc'), limit(500));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PqrApprovalHistoryEntry));
  } catch {
    const rows = await readCollection(PQR_APPROVAL_COLLECTIONS.approvalHistory);
    return rows
      .filter((r) => !r.isDeleted && (!pqrId || r.pqrId === pqrId))
      .map((r) => r as unknown as PqrApprovalHistoryEntry);
  }
}

export async function submitPqrForApproval(
  pqr: PqrOption,
  actor: PqrApprovalActor,
): Promise<{ error?: string; created?: number }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };

  const authErr = assertActorCanSubmit(actor);
  if (authErr) return { error: authErr };

  const validation = await validatePqrForSubmission(pqr.id);
  if (!validation.valid) return { error: validation.errors.join(' ') };

  try {
    await logApprovalAudit('PQR submitted', actor, { pqrId: pqr.id }, pqr.id);

    const existing = await fetchApprovalRecords(pqr.id);
    if (existing.length) {
      const batch = writeBatch(getFirebaseFirestore());
      existing.forEach((r) => {
        if (r.id) {
          batch.update(doc(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals, r.id), {
            isDeleted: true,
            updatedAt: nowIso(),
            updatedBy: actor.id,
          });
        }
      });
      await batch.commit();
    }

    const steps = await resolveWorkflowSteps(pqr);
    if (!steps.length) {
      return { error: 'No active approval workflow is configured for PQR. Configure approval matrix first.' };
    }
    const batch = writeBatch(getFirebaseFirestore());
    let created = 0;
    steps.forEach((step, i) => {
      const record = stepToRecord(step, pqr, actor, i === 0);
      batch.set(doc(collection(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals)), record);
      created += 1;
    });
    await batch.commit();

    await updatePqrRecordStatus(pqr.id, {
      status: 'Under Review',
      workflowStatus: 'Under Review',
      currentWorkflowStep: steps[0]?.stepName,
      submittedAt: nowIso(),
      submittedBy: actor.id,
      locked: false,
    }, actor);

    await saveHistory({
      pqrId: pqr.id,
      pqrNumber: pqr.pqrNumber,
      approvalId: buildApprovalId(pqr.pqrNumber, 0),
      action: 'PQR submitted',
      approvalType: 'Prepared By',
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role || '',
      comments: 'Submitted for approval workflow',
      eSignatureStatus: 'N/A',
      createdAt: nowIso(),
      createdBy: actor.id,
      isDeleted: false,
    }, actor);

    // Do not notify with empty userId; note next step in remarks if no assignee
    if (actor.id) {
      await createNotification(
        actor.id,
        'PQR Submitted for Review',
        `${pqr.pqrNumber} submitted for approval — next: ${steps[0]?.stepName || 'review'}`,
        pqr.id,
      );
    }

    return { created };
  } catch (e) {
    return { error: userSafeError('Unable to submit PQR for approval.', e) };
  }
}

async function activateNextStep(
  pqrId: string,
  approvals: PqrApprovalRecord[],
  actor: PqrApprovalActor,
): Promise<PqrApprovalRecord | null> {
  const next = approvals
    .filter((a) => !a.isDeleted && a.approvalStatus === 'Pending')
    .sort((a, b) => a.approvalLevel - b.approvalLevel)[0];

  if (!next?.id) return null;

  const ts = nowIso();
  const stepDef: PqrWorkflowStepDef = {
    level: next.approvalLevel,
    approvalType: next.approvalType as PqrWorkflowStepDef['approvalType'],
    approverRole: next.currentApproverRole,
    stepName: next.currentWorkflowStep,
    designation: next.currentWorkflowStep,
    dueDays: 7,
    eSignatureRequired: next.eSignatureRequired,
    commentRequired: Boolean(next.commentRequired),
  };
  const workflowStatus = mapWorkflowStatusForStep(stepDef);
  const noAssigneeNote = !next.currentApproverUser
    ? `Awaiting ${next.currentApproverRole || 'approver'} — no user assigned yet`
    : '';

  await updateDoc(doc(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals, next.id), {
    approvalStatus: 'In Review',
    eSignatureStatus: next.eSignatureRequired ? 'Required' : 'Not Required',
    workflowStatus,
    remarks: noAssigneeNote || next.remarks || '',
    updatedAt: ts,
    updatedBy: actor.id,
  });

  await updatePqrRecordStatus(pqrId, {
    workflowStatus,
    currentWorkflowStep: next.currentWorkflowStep,
  }, actor);

  if (next.currentApproverUser) {
    await createNotification(
      next.currentApproverUser,
      'PQR Pending Your Approval',
      `${next.pqrNumber} — ${next.currentWorkflowStep}`,
      pqrId,
    );
  }

  return { ...next, approvalStatus: 'In Review', workflowStatus };
}

export async function completeApprovalStep(
  approvalId: string,
  pqrId: string,
  comments: string,
  actor: PqrApprovalActor,
  esignApplied = false,
  expectedRevision?: number,
): Promise<{ error?: string; completed?: boolean }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };

  try {
    const approvals = await fetchApprovalRecords(pqrId);
    const current = approvals.find((a) => a.id === approvalId || a.approvalId === approvalId);
    if (!current?.id) return { error: 'Approval record not found.' };
    if (!['In Review', 'Escalated'].includes(current.approvalStatus)) {
      return { error: 'This approval step is not active.' };
    }
    if (!canActOnApproval(actor.role, current.currentApproverRole)) {
      return { error: 'You are not authorized to act on this approval step.' };
    }
    if (current.eSignatureRequired && !esignApplied) {
      return { error: 'Electronic signature is required for this approval step.' };
    }
    if (current.commentRequired && !comments.trim()) {
      return { error: 'Comments are required for this approval step.' };
    }
    if (expectedRevision !== undefined && (current.revision ?? 1) !== expectedRevision) {
      return { error: 'This approval step was updated by another user. Refresh and try again.' };
    }

    const ts = nowIso();
    const nextRevision = (current.revision ?? 1) + 1;
    await updateDoc(doc(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals, current.id), {
      approvalStatus: 'Approved',
      approvalComments: comments,
      eSignatureStatus: esignApplied ? 'Signed' : 'N/A',
      signedBy: esignApplied ? actor.name : '',
      signedDate: esignApplied ? ts.slice(0, 10) : '',
      completedDate: ts,
      currentApproverUser: actor.id,
      revision: nextRevision,
      updatedAt: ts,
      updatedBy: actor.id,
    });

    await saveHistory({
      pqrId,
      pqrNumber: current.pqrNumber,
      approvalId: current.approvalId,
      action: 'approval completed',
      approvalType: current.approvalType,
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role || '',
      comments,
      eSignatureStatus: esignApplied ? 'Signed' : 'N/A',
      createdAt: ts,
      createdBy: actor.id,
      isDeleted: false,
    }, actor);

    await logApprovalAudit('approval completed', actor, { approvalId: current.approvalId }, current.id);

    const pending = approvals.filter((a) =>
      !a.isDeleted && a.id !== current.id && ['Pending', 'In Review', 'Escalated'].includes(a.approvalStatus),
    );

    if (pending.length === 0 || current.approvalType === 'Final Approved By') {
      if (pending.length) {
        await cancelRemainingSteps(approvals, current.id, 'Approved', actor);
      }
      await updatePqrRecordStatus(pqrId, {
        status: 'Approved',
        workflowStatus: 'Approved',
        approvedAt: ts,
        approvedBy: actor.id,
        locked: true,
      }, actor);
      await lockPqrSections(pqrId, actor);
      await logApprovalAudit('final approval', actor, { pqrId }, pqrId);
      await saveHistory({
        pqrId,
        pqrNumber: current.pqrNumber,
        approvalId: current.approvalId,
        action: 'final approval',
        approvalType: 'Final Approved By',
        userId: actor.id,
        userName: actor.name,
        userRole: actor.role || '',
        comments: comments || 'Final approval completed',
        eSignatureStatus: esignApplied ? 'Signed' : 'N/A',
        createdAt: ts,
        createdBy: actor.id,
        isDeleted: false,
      }, actor);
      await logApprovalAudit('PQR locked', actor, { pqrId }, pqrId);
      return { completed: true };
    }

    await activateNextStep(pqrId, approvals, actor);
    return { completed: false };
  } catch (e) {
    return { error: userSafeError('Unable to complete approval step.', e) };
  }
}

export async function rejectPqrApproval(
  approvalId: string,
  pqrId: string,
  reason: string,
  actor: PqrApprovalActor,
  esignApplied = false,
  expectedRevision?: number,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (!reason.trim()) return { error: 'Rejection reason is required.' };

  try {
    const approvals = await fetchApprovalRecords(pqrId);
    const current = approvals.find((a) => a.id === approvalId || a.approvalId === approvalId);
    if (!current?.id) return { error: 'Approval record not found.' };
    if (!['In Review', 'Escalated'].includes(current.approvalStatus)) {
      return { error: 'This approval step is not active.' };
    }
    if (!canActOnApproval(actor.role, current.currentApproverRole)) {
      return { error: 'You are not authorized to act on this approval step.' };
    }
    if (current.eSignatureRequired && !esignApplied) {
      return { error: 'Electronic signature is required for this approval step.' };
    }
    if (expectedRevision !== undefined && (current.revision ?? 1) !== expectedRevision) {
      return { error: 'This approval step was updated by another user. Refresh and try again.' };
    }

    const ts = nowIso();
    await updateDoc(doc(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals, current.id), {
      approvalStatus: 'Rejected',
      rejectionReason: reason,
      eSignatureStatus: esignApplied ? 'Signed' : 'N/A',
      signedBy: esignApplied ? actor.name : '',
      signedDate: esignApplied ? ts.slice(0, 10) : '',
      completedDate: ts,
      workflowStatus: 'Rejected',
      revision: (current.revision ?? 1) + 1,
      updatedAt: ts,
      updatedBy: actor.id,
    });

    await cancelRemainingSteps(approvals, current.id, 'Rejected', actor);

    await updatePqrRecordStatus(pqrId, { status: 'Rejected', workflowStatus: 'Rejected', locked: false }, actor);

    await saveHistory({
      pqrId, pqrNumber: current.pqrNumber, approvalId: current.approvalId,
      action: 'rejection', approvalType: 'Rejected By',
      userId: actor.id, userName: actor.name, userRole: actor.role || '',
      comments: reason, eSignatureStatus: esignApplied ? 'Signed' : 'N/A',
      createdAt: ts, createdBy: actor.id, isDeleted: false,
    }, actor);

    await logApprovalAudit('rejection', actor, { reason }, current.id);
    if (current.createdBy) {
      await createNotification(current.createdBy, 'PQR Rejected', `${current.pqrNumber} was rejected: ${reason}`, pqrId);
    }
    return {};
  } catch (e) {
    return { error: userSafeError('Unable to reject PQR approval.', e) };
  }
}

export async function sendBackPqrApproval(
  approvalId: string,
  pqrId: string,
  reason: string,
  actor: PqrApprovalActor,
  expectedRevision?: number,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (!reason.trim()) return { error: 'Send back reason is required.' };

  try {
    const approvals = await fetchApprovalRecords(pqrId);
    const current = approvals.find((a) => a.id === approvalId || a.approvalId === approvalId);
    if (!current?.id) return { error: 'Approval record not found.' };
    if (!['In Review', 'Escalated'].includes(current.approvalStatus)) {
      return { error: 'This approval step is not active.' };
    }
    if (!canActOnApproval(actor.role, current.currentApproverRole)) {
      return { error: 'You are not authorized to act on this approval step.' };
    }
    if (expectedRevision !== undefined && (current.revision ?? 1) !== expectedRevision) {
      return { error: 'This approval step was updated by another user. Refresh and try again.' };
    }

    const ts = nowIso();
    await updateDoc(doc(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals, current.id), {
      approvalStatus: 'Sent Back',
      sendBackReason: reason,
      workflowStatus: 'Returned for Correction',
      revision: (current.revision ?? 1) + 1,
      updatedAt: ts,
      updatedBy: actor.id,
    });

    // CRITICAL: cancel remaining Pending / In Review / Escalated steps
    await cancelRemainingSteps(approvals, current.id, 'Returned for Correction', actor);

    await updatePqrRecordStatus(pqrId, {
      status: 'Returned for Correction',
      workflowStatus: 'Returned for Correction',
      locked: false,
    }, actor);

    await unlockPqrSections(pqrId, actor);

    await saveHistory({
      pqrId, pqrNumber: current.pqrNumber, approvalId: current.approvalId,
      action: 'send back', approvalType: 'Sent Back By',
      userId: actor.id, userName: actor.name, userRole: actor.role || '',
      comments: reason, eSignatureStatus: 'N/A',
      createdAt: ts, createdBy: actor.id, isDeleted: false,
    }, actor);

    await logApprovalAudit('send back', actor, { reason }, current.id);
    if (current.createdBy) {
      await createNotification(current.createdBy, 'PQR Returned for Correction', `${current.pqrNumber}: ${reason}`, pqrId);
    }
    return {};
  } catch (e) {
    return { error: userSafeError('Unable to return PQR for correction.', e) };
  }
}

export async function escalateApproval(
  approvalId: string,
  pqrId: string,
  actor: PqrApprovalActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const approvals = await fetchApprovalRecords(pqrId);
    const current = approvals.find((a) => a.id === approvalId || a.approvalId === approvalId);
    if (!current?.id) return { error: 'Approval record not found.' };
    if (!canActOnApproval(actor.role, current.currentApproverRole) && !canReassignApproval(actor.role)) {
      return { error: 'You are not authorized to escalate this approval.' };
    }

    await updateDoc(doc(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals, current.id), {
      approvalStatus: 'Escalated',
      escalationStatus: 'Escalated',
      priority: 'Critical',
      revision: (current.revision ?? 1) + 1,
      updatedAt: nowIso(),
      updatedBy: actor.id,
    });

    await logApprovalAudit('escalation', actor, { approvalId }, current.id);
    if (current.createdBy) {
      await createNotification(current.createdBy, 'Overdue PQR Approval', `${current.pqrNumber} approval escalated`, pqrId);
    }
    return {};
  } catch (e) {
    return { error: userSafeError('Unable to escalate approval.', e) };
  }
}

export async function reassignApprover(
  approvalId: string,
  pqrId: string,
  newUserId: string,
  newUserName: string,
  actor: PqrApprovalActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (!canReassignApproval(actor.role)) {
    return { error: 'You are not authorized to reassign approvals.' };
  }
  try {
    const approvals = await fetchApprovalRecords(pqrId);
    const current = approvals.find((a) => a.id === approvalId || a.approvalId === approvalId);
    if (!current?.id) return { error: 'Approval record not found.' };

    await updateDoc(doc(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals, current.id), {
      currentApproverUser: newUserId,
      remarks: `Reassigned to ${newUserName}`,
      revision: (current.revision ?? 1) + 1,
      updatedAt: nowIso(),
      updatedBy: actor.id,
    });

    await logApprovalAudit('reassignment', actor, { newUserId, newUserName }, current.id);
    if (newUserId) {
      await createNotification(newUserId, 'PQR Approval Reassigned', `${current.pqrNumber} assigned to you`, pqrId);
    }
    return {};
  } catch (e) {
    return { error: userSafeError('Unable to reassign approver.', e) };
  }
}

export async function archiveApprovedPqr(
  pqrId: string,
  actor: PqrApprovalActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (!canArchivePqrApproval(actor.role)) {
    return { error: 'You are not authorized to archive this PQR.' };
  }
  try {
    await updatePqrRecordStatus(pqrId, { status: 'Archived', workflowStatus: 'Archived', archivedAt: nowIso() }, actor);
    const approvals = await fetchApprovalRecords(pqrId);
    const batch = writeBatch(getFirebaseFirestore());
    approvals.forEach((a) => {
      if (a.id) {
        batch.update(doc(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals, a.id), {
          workflowStatus: 'Archived',
          updatedAt: nowIso(),
          updatedBy: actor.id,
        });
      }
    });
    await batch.commit();
    await logApprovalAudit('PQR archived', actor, { pqrId }, pqrId);
    return {};
  } catch (e) {
    return { error: userSafeError('Unable to archive PQR.', e) };
  }
}

export async function reopenApprovedPqr(
  pqrId: string,
  reason: string,
  actor: PqrApprovalActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (!reason.trim()) return { error: 'Reason is required.' };
  if (!canReopenApprovedPqr(actor.role)) {
    return { error: 'You are not authorized to reopen approved PQRs.' };
  }

  try {
    await unlockPqrSections(pqrId, actor);

    const approvals = await fetchApprovalRecords(pqrId);
    if (approvals.length) {
      const batch = writeBatch(getFirebaseFirestore());
      const ts = nowIso();
      approvals.forEach((a) => {
        if (a.id) {
          batch.update(doc(getFirebaseFirestore(), PQR_APPROVAL_COLLECTIONS.approvals, a.id), {
            isDeleted: true,
            approvalStatus: a.approvalStatus === 'Approved' ? a.approvalStatus : 'Cancelled',
            updatedAt: ts,
            updatedBy: actor.id,
          });
        }
      });
      await batch.commit();
    }

    await updatePqrRecordStatus(pqrId, {
      status: 'Under Review',
      workflowStatus: 'Under Review',
      locked: false,
      reopenedAt: nowIso(),
      reopenReason: reason,
    }, actor);

    await logApprovalAudit('PQR reopened', actor, { reason }, pqrId);
    await saveHistory({
      pqrId, pqrNumber: approvals[0]?.pqrNumber || '', approvalId: '',
      action: 'PQR reopened', approvalType: 'Reviewed By',
      userId: actor.id, userName: actor.name, userRole: actor.role || '',
      comments: reason, eSignatureStatus: 'N/A',
      createdAt: nowIso(), createdBy: actor.id, isDeleted: false,
    }, actor);
    return {};
  } catch (e) {
    return { error: userSafeError('Unable to reopen PQR.', e) };
  }
}

export {
  computeDashboardCounts,
  daysPending,
  getCurrentPendingStep,
  getActableStep,
  canViewPqrApproval,
  canSubmitPqrApproval,
  canActOnApproval,
  canReopenApprovedPqr,
  canReassignApproval,
  canArchivePqrApproval,
  roleMatchesStep,
  matrixLabelToApprovalType,
  normalizeApproverRole,
} from '@/lib/pqr-approval-records';

export async function logPqrApprovalView(actor: PqrApprovalActor) {
  await logApprovalAudit('PQR approval viewed', actor);
}

export async function logEsignSuccess(actor: PqrApprovalActor, approvalId: string) {
  await logApprovalAudit('e-signature success', actor, { approvalId }, approvalId);
}

export async function logEsignFailed(actor: PqrApprovalActor, approvalId: string, error: string) {
  await logApprovalAudit('e-signature failed', actor, { approvalId, error }, approvalId);
}

import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { getFirebaseFirestore } from '@/lib/firebase';
import { logAuditEvent } from '@/lib/admin/admin-service';
import { downloadCsv } from '@/lib/export-utils';
import { listDocuments, getDocumentById } from '@/lib/dms-service';
import type {
  DocumentReviewRecord, ReviewWorkflowDefinition, ReviewKpis, ReviewCharts,
  ReviewFilters, ReviewActor,
} from './document-review-types';
import {
  mapReviewRaw, computeReviewKpis, computeReviewCharts, filterReviewRecords,
  emptyReviewKpis, emptyReviewCharts,
} from './document-review-records';
import type { ReviewCreateInput, ReviewCompleteInput } from './document-review-schemas';
import {
  DRW_COLLECTIONS, DEFAULT_CHECKLIST, computeSlaStatus,
  canViewAssignedOnly,
} from './document-review-types';

function now() { return new Date().toISOString(); }

async function audit(actor: ReviewActor, action: string, recordId: string, oldValue: unknown, newValue: unknown, reason = '') {
  await logAuditEvent({
    userId: actor.id, userName: actor.name, module: 'Document Review', recordId, action,
    oldValue: oldValue ? JSON.stringify(oldValue) : '',
    newValue: newValue ? JSON.stringify(newValue) : '',
    reason, ipAddress: 'client', device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
    status: 'Success',
  });
}

async function notify(title: string, message: string, recordId: string, roles: string[], userIds: string[] = []) {
  try {
    const db = getFirebaseFirestore();
    for (const role of roles) {
      await addDoc(collection(db, DRW_COLLECTIONS.notifications), {
        title, message, module: 'Document Review', record_id: recordId, target_role: role, read: false, created_at: now(),
      });
    }
    for (const uid of userIds) {
      await addDoc(collection(db, DRW_COLLECTIONS.notifications), {
        title, message, module: 'Document Review', record_id: recordId, target_user_id: uid, read: false, created_at: now(),
      });
    }
  } catch (e) { console.error('Review notification failed:', e); }
}

export async function generateReviewNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `REV-${year}-`;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DRW_COLLECTIONS.reviews),
      where('review_number', '>=', prefix),
      where('review_number', '<=', `${prefix}\uf8ff`),
      orderBy('review_number', 'desc'),
      limit(1),
    ));
    if (!snap.empty) {
      const last = snap.docs[0].data().review_number as string;
      return `${prefix}${String(parseInt(last.split('-').pop() || '0', 10) + 1).padStart(4, '0')}`;
    }
  } catch {
    const all = await getDocs(collection(getFirebaseFirestore(), DRW_COLLECTIONS.reviews));
    return `${prefix}${String(all.size + 1).padStart(4, '0')}`;
  }
  return `${prefix}0001`;
}

async function listAllReviews(): Promise<DocumentReviewRecord[]> {
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), DRW_COLLECTIONS.reviews), orderBy('updated_at', 'desc')));
    return snap.docs.map((d) => mapReviewRaw({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), DRW_COLLECTIONS.reviews));
    return snap.docs.map((d) => mapReviewRaw({ id: d.id, ...d.data() }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
}

export async function fetchWorkflowDefinitions(): Promise<ReviewWorkflowDefinition[]> {
  try {
    const snap = await getDocs(collection(getFirebaseFirestore(), DRW_COLLECTIONS.workflows));
    if (snap.empty) return [];
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReviewWorkflowDefinition));
  } catch {
    return [];
  }
}

export async function saveWorkflowDefinition(workflow: ReviewWorkflowDefinition, actor: ReviewActor): Promise<void> {
  await setDoc(doc(getFirebaseFirestore(), DRW_COLLECTIONS.workflows, workflow.id), { ...workflow, updated_at: now() }, { merge: true });
  for (const step of workflow.steps) {
    await setDoc(doc(getFirebaseFirestore(), DRW_COLLECTIONS.steps, `${workflow.id}-${step.order}-${step.role}`), {
      workflow_id: workflow.id, ...step, updated_at: now(),
    }, { merge: true });
  }
  await audit(actor, 'WORKFLOW_SAVED', workflow.id, null, workflow);
}

export async function syncReviewsFromDocuments(): Promise<number> {
  const docs = await listDocuments();
  const reviewDocs = docs.filter((d) => ['under_review', 'returned_for_correction', 'pending_approval'].includes(d.status));
  let created = 0;
  for (const d of reviewDocs) {
    const existing = await getDocs(query(
      collection(getFirebaseFirestore(), DRW_COLLECTIONS.reviews),
      where('document_id', '==', d.id),
      limit(5),
    ));
    const hasOpen = existing.docs.some((docSnap) => {
      const s = docSnap.data().review_status as string;
      return ['Pending Review', 'Under Review', 'Returned for Revision'].includes(s);
    });
    if (hasOpen) continue;

    const revNum = await generateReviewNumber();
    const due = new Date();
    due.setDate(due.getDate() + 14);
    const dueDate = due.toISOString().split('T')[0];
    const status = d.status === 'returned_for_correction' ? 'Returned for Revision' : 'Pending Review';

    await addDoc(collection(getFirebaseFirestore(), DRW_COLLECTIONS.reviews), {
      review_id: revNum, review_number: revNum,
      document_id: d.id, document_number: d.document_number,
      document_title: d.document_title, document_type: d.document_type,
      version: d.version, workflow_type: 'Standard Sequential Review',
      review_mode: 'Sequential', current_step: 1, total_steps: 2,
      reviewer_id: d.reviewed_by || 'pending', reviewer_name: d.reviewed_by_name || 'Pending Assignment',
      reviewer_role: 'qa_manager', department: d.department,
      due_date: dueDate, completed_date: null, review_decision: null,
      review_status: status, review_checklist: DEFAULT_CHECKLIST,
      review_comments: '', revision_requested: d.status === 'returned_for_correction',
      revision_summary: d.reason_for_revision || '', priority: 'Normal',
      sla_status: computeSlaStatus(dueDate, status),
      workflow_id: 'seq-standard', step_id: null, started_at: null,
      created_by: d.created_by, created_by_name: d.created_by_name,
      updated_by: d.updated_by, updated_by_name: d.updated_by_name,
      created_at: now(), updated_at: now(),
    });
    created++;
  }
  return created;
}

export async function syncOverdueReviews(): Promise<number> {
  const records = await listAllReviews();
  let count = 0;
  for (const r of records) {
    if (r.review_status === 'Completed' || r.review_status === 'Cancelled') continue;
    const sla = computeSlaStatus(r.due_date, r.review_status, r.completed_date);
    if (sla !== r.sla_status) {
      await updateDoc(doc(getFirebaseFirestore(), DRW_COLLECTIONS.reviews, r.id), { sla_status: sla, updated_at: now() });
      if (sla === 'Overdue') {
        await notify('Review Overdue', `${r.document_number} review overdue`, r.id, ['qa_manager', 'head_qa'], [r.reviewer_id]);
        await audit({ id: 'system', name: 'System', role: 'system' }, 'REVIEW_OVERDUE', r.id, r.sla_status, sla);
      }
      count++;
    }
  }
  return count;
}

export async function createReview(input: ReviewCreateInput, actor: ReviewActor): Promise<DocumentReviewRecord> {
  const docRecord = await getDocumentById(input.document_id);
  if (!docRecord) throw new Error('Document not found');
  if (input.version !== docRecord.version) throw new Error('Version mismatch');

  const workflows = await fetchWorkflowDefinitions();
  const workflow = workflows.find((w) => w.id === input.workflow_id);
  if (!workflow) throw new Error('Workflow not found');

  const revNum = await generateReviewNumber();
  const timestamp = now();
  const payload = {
    review_id: revNum, review_number: revNum,
    document_id: docRecord.id, document_number: docRecord.document_number,
    document_title: docRecord.document_title, document_type: docRecord.document_type,
    version: input.version, workflow_type: workflow.name,
    review_mode: input.review_mode, current_step: 1,
    total_steps: workflow.steps.length,
    reviewer_id: input.reviewer_id, reviewer_name: input.reviewer_name,
    reviewer_role: input.reviewer_role, department: input.department,
    due_date: input.due_date, completed_date: null, review_decision: null,
    review_status: 'Pending Review', review_checklist: DEFAULT_CHECKLIST.map((c) => ({ ...c })),
    review_comments: '', revision_requested: false, revision_summary: '',
    priority: input.priority, sla_status: computeSlaStatus(input.due_date, 'Pending Review'),
    workflow_id: input.workflow_id, step_id: `${input.workflow_id}-1`,
    started_at: null,
    created_by: actor.id, created_by_name: actor.name,
    updated_by: actor.id, updated_by_name: actor.name,
    created_at: timestamp, updated_at: timestamp,
  };

  const ref = await addDoc(collection(getFirebaseFirestore(), DRW_COLLECTIONS.reviews), payload);

  if (workflow.review_mode === 'Parallel') {
    for (const step of workflow.steps.filter((s) => s.order === 1)) {
      await addDoc(collection(getFirebaseFirestore(), DRW_COLLECTIONS.reviews), {
        ...payload, review_id: `${revNum}-${step.role}`, review_number: `${revNum}-${step.order}`,
        reviewer_role: step.role, current_step: step.order, step_id: `${workflow.id}-${step.order}-${step.role}`,
        review_status: 'Pending Review',
      });
    }
  }

  await notify('Review Assigned', `${docRecord.document_number} assigned for review`, ref.id, [input.reviewer_role], [input.reviewer_id]);
  await audit(actor, 'REVIEW_CREATED', ref.id, null, payload);
  return { id: ref.id, ...payload };
}

export async function startReview(reviewId: string, actor: ReviewActor): Promise<DocumentReviewRecord> {
  const record = await getReviewById(reviewId);
  if (!record) throw new Error('Review not found');
  if (record.reviewer_id !== actor.id && !['super_admin', 'admin', 'qa_manager', 'head_qa'].includes(actor.role)) {
    throw new Error('Not assigned to this review');
  }
  const updates = {
    review_status: 'Under Review', started_at: now(), updated_at: now(),
    updated_by: actor.id, updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), DRW_COLLECTIONS.reviews, reviewId), updates);
  await audit(actor, 'REVIEW_STARTED', reviewId, record.review_status, 'Under Review');
  return { ...record, ...updates, review_status: 'Under Review' };
}

export async function addReviewComment(reviewId: string, comment: string, actor: ReviewActor): Promise<void> {
  await addDoc(collection(getFirebaseFirestore(), DRW_COLLECTIONS.comments), {
    review_id: reviewId, comment, author_id: actor.id, author_name: actor.name, created_at: now(),
  });
  const record = await getReviewById(reviewId);
  if (record) {
    const combined = record.review_comments ? `${record.review_comments}\n${comment}` : comment;
    await updateDoc(doc(getFirebaseFirestore(), DRW_COLLECTIONS.reviews, reviewId), {
      review_comments: combined, updated_at: now(),
    });
  }
  await audit(actor, 'COMMENT_ADDED', reviewId, null, comment);
}

async function advanceWorkflow(completedReview: DocumentReviewRecord, actor: ReviewActor): Promise<boolean> {
  const workflows = await fetchWorkflowDefinitions();
  const workflow = workflows.find((w) => w.id === completedReview.workflow_id);
  if (!workflow) return false;

  if (workflow.review_mode === 'Parallel') {
    const siblingSnap = await getDocs(query(
      collection(getFirebaseFirestore(), DRW_COLLECTIONS.reviews),
      where('document_id', '==', completedReview.document_id),
    ));
    const siblings = siblingSnap.docs.map((d) => mapReviewRaw({ id: d.id, ...d.data() }));
    const mandatory = siblings.filter((s) => s.id !== completedReview.id);
    const allDone = mandatory.every((s) => s.review_status === 'Completed' || s.review_decision === 'Approved' || s.review_decision === 'Approved with Comments');
    if (!allDone) return false;
    await notify('Workflow Advanced', `${completedReview.document_number} all parallel reviews complete`, completedReview.id, ['qa_manager', 'head_qa']);
    await audit(actor, 'WORKFLOW_ADVANCED', completedReview.document_id, 'parallel', 'all_complete');
    return true;
  }

  if (completedReview.current_step >= completedReview.total_steps) return false;

  const nextStep = workflow.steps.find((s) => s.order === completedReview.current_step + 1);
  if (!nextStep) return false;

  const revNum = await generateReviewNumber();
  await addDoc(collection(getFirebaseFirestore(), DRW_COLLECTIONS.reviews), {
    review_id: revNum, review_number: revNum,
    document_id: completedReview.document_id, document_number: completedReview.document_number,
    document_title: completedReview.document_title, document_type: completedReview.document_type,
    version: completedReview.version, workflow_type: workflow.name,
    review_mode: workflow.review_mode, current_step: nextStep.order, total_steps: workflow.steps.length,
    reviewer_id: 'pending', reviewer_name: 'Pending Assignment', reviewer_role: nextStep.role,
    department: completedReview.department,
    due_date: completedReview.due_date, review_status: 'Pending Review',
    review_checklist: DEFAULT_CHECKLIST.map((c) => ({ ...c })),
    workflow_id: workflow.id, step_id: `${workflow.id}-${nextStep.order}-${nextStep.role}`,
    priority: completedReview.priority, sla_status: computeSlaStatus(completedReview.due_date, 'Pending Review'),
    created_by: actor.id, created_by_name: actor.name, updated_by: actor.id, updated_by_name: actor.name,
    created_at: now(), updated_at: now(),
  });

  await notify('Workflow Advanced', `${completedReview.document_number} advanced to ${nextStep.name}`, completedReview.id, [nextStep.role]);
  await audit(actor, 'WORKFLOW_ADVANCED', completedReview.document_id, completedReview.current_step, nextStep.order);
  return true;
}

export async function completeReview(reviewId: string, input: ReviewCompleteInput, actor: ReviewActor): Promise<DocumentReviewRecord> {
  const record = await getReviewById(reviewId);
  if (!record) throw new Error('Review not found');

  if (input.checklist) {
    const missing = input.checklist.filter((c) => c.required && !c.checked);
    if (missing.length) throw new Error(`Complete required checklist items: ${missing.map((m) => m.label).join(', ')}`);
  }

  const timestamp = now();
  const revisionRequested = input.decision === 'Revision Required';
  const newStatus = revisionRequested ? 'Returned for Revision' : 'Completed';
  const updates = {
    review_decision: input.decision,
    review_status: newStatus,
    completed_date: timestamp,
    review_comments: input.comments || record.review_comments,
    revision_requested: revisionRequested,
    revision_summary: input.revision_summary || record.revision_summary,
    review_checklist: input.checklist || record.review_checklist,
    sla_status: computeSlaStatus(record.due_date, 'Completed', timestamp),
    updated_at: timestamp, updated_by: actor.id, updated_by_name: actor.name,
  };

  await updateDoc(doc(getFirebaseFirestore(), DRW_COLLECTIONS.reviews, reviewId), updates);

  if (input.comments) {
    await addDoc(collection(getFirebaseFirestore(), DRW_COLLECTIONS.comments), {
      review_id: reviewId, comment: input.comments, author_id: actor.id, author_name: actor.name, created_at: timestamp,
    });
  }

  const result = { ...record, ...updates };

  if (revisionRequested) {
    await notify('Revision Requested', `${record.document_number} — revision required`, reviewId, ['qa_manager'], []);
    await audit(actor, 'REVISION_REQUESTED', reviewId, record.review_status, input.revision_summary || input.comments);
  } else {
    await notify('Review Completed', `${record.document_number} review completed`, reviewId, ['qa_manager', 'head_qa'], []);
    await audit(actor, 'REVIEW_COMPLETED', reviewId, record.review_status, input.decision, input.comments);
    if (!revisionRequested && input.decision !== 'Rejected') {
      await advanceWorkflow(result, actor);
    }
  }

  return result;
}

export async function fetchReviewDashboardData(filters?: ReviewFilters, actor?: ReviewActor) {
  await Promise.all([syncReviewsFromDocuments(), syncOverdueReviews()]);
  let records = await listAllReviews();
  const role = actor?.role || '';
  if (canViewAssignedOnly(role) && actor?.id) {
    records = records.filter((r) => r.reviewer_id === actor.id);
  }
  if (filters) records = filterReviewRecords(records, filters);
  return { records, metrics: computeReviewKpis(records), charts: computeReviewCharts(records) };
}

export async function getReviewById(id: string): Promise<DocumentReviewRecord | null> {
  const snap = await getDoc(doc(getFirebaseFirestore(), DRW_COLLECTIONS.reviews, id));
  if (!snap.exists()) return null;
  return mapReviewRaw({ id: snap.id, ...snap.data() });
}

export async function getReviewComments(reviewId: string) {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DRW_COLLECTIONS.comments),
      where('review_id', '==', reviewId),
      orderBy('created_at', 'asc'),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DRW_COLLECTIONS.comments),
      where('review_id', '==', reviewId),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

export function exportReviewsCsv(records: DocumentReviewRecord[]) {
  downloadCsv('document-reviews.csv',
    ['Review Number', 'Document', 'Version', 'Reviewer', 'Department', 'Status', 'Decision', 'Due Date', 'SLA'],
    records.map((r) => [r.review_number, r.document_number, r.version, r.reviewer_name, r.department, r.review_status, r.review_decision, r.due_date, r.sla_status]),
  );
}

export function exportReviewsExcel(records: DocumentReviewRecord[]) { exportReviewsCsv(records); }

export async function logReviewDashboardViewed(actor: ReviewActor) {
  await audit(actor, 'DASHBOARD_VIEWED', 'review-dashboard', null, null);
}

export async function logReviewExported(actor: ReviewActor, format: string, count: number) {
  await audit(actor, 'REVIEW_EXPORTED', 'review-dashboard', null, { format, count });
}

export async function sendReviewReminders(reviewIds: string[], actor: ReviewActor): Promise<number> {
  let count = 0;
  for (const id of reviewIds) {
    const r = await getReviewById(id);
    if (!r || r.review_status === 'Completed') continue;
    await notify('Review Reminder', `Reminder: review ${r.document_number}`, id, [], [r.reviewer_id]);
    await audit(actor, 'REMINDER_SENT', id, null, r.reviewer_name);
    count++;
  }
  return count;
}

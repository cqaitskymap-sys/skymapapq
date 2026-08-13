import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { getFirebaseFirestore } from '@/lib/firebase';
import { logAuditEvent } from '@/lib/admin/admin-service';
import { downloadCsv } from '@/lib/export-utils';
import { listDocuments, getDocumentById, syncEffectiveDocuments } from '@/lib/dms-service';
import type {
  DocumentApprovalRecord, ApprovalWorkflowDefinition, ApprovalFilters, ApprovalActor,
} from './document-approval-types';
import {
  mapApprovalRaw, computeApprovalKpis, computeApprovalCharts, filterApprovalRecords,
  emptyApprovalKpis, emptyApprovalCharts,
} from './document-approval-records';
import type { ApprovalCreateInput, ApprovalCompleteInput, ApprovalDelegateInput } from './document-approval-schemas';
import {
  DAW_COLLECTIONS, DAW_MODULE_TAG, computeApprovalSlaStatus,
  canViewAssignedApprovalsOnly,
} from './document-approval-types';

function now() { return new Date().toISOString(); }

async function audit(actor: ApprovalActor, action: string, recordId: string, oldValue: unknown, newValue: unknown, reason = '') {
  await logAuditEvent({
    userId: actor.id, userName: actor.name, module: 'Document Approval', recordId, action,
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
      await addDoc(collection(db, DAW_COLLECTIONS.notifications), {
        title, message, module: 'Document Approval', record_id: recordId, target_role: role, read: false, created_at: now(),
      });
    }
    for (const uid of userIds) {
      await addDoc(collection(db, DAW_COLLECTIONS.notifications), {
        title, message, module: 'Document Approval', record_id: recordId, target_user_id: uid, read: false, created_at: now(),
      });
    }
  } catch (e) { console.error('Approval notification failed:', e); }
}

export async function generateApprovalNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `APR-${year}-`;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DAW_COLLECTIONS.approvals),
      where('approval_number', '>=', prefix),
      where('approval_number', '<=', `${prefix}\uf8ff`),
      orderBy('approval_number', 'desc'),
      limit(1),
    ));
    if (!snap.empty) {
      const last = snap.docs[0].data().approval_number as string;
      return `${prefix}${String(parseInt(last.split('-').pop() || '0', 10) + 1).padStart(4, '0')}`;
    }
  } catch {
    const all = await getDocs(query(
      collection(getFirebaseFirestore(), DAW_COLLECTIONS.approvals),
      where('module', '==', DAW_MODULE_TAG),
    ));
    return `${prefix}${String(all.size + 1).padStart(4, '0')}`;
  }
  return `${prefix}0001`;
}

async function listAllApprovals(): Promise<DocumentApprovalRecord[]> {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DAW_COLLECTIONS.approvals),
      where('module', '==', DAW_MODULE_TAG),
      orderBy('updated_at', 'desc'),
    ));
    return snap.docs.map((d) => mapApprovalRaw({ id: d.id, ...d.data() })).filter(Boolean) as DocumentApprovalRecord[];
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), DAW_COLLECTIONS.approvals));
    return snap.docs
      .map((d) => mapApprovalRaw({ id: d.id, ...d.data() }))
      .filter(Boolean)
      .sort((a, b) => (b?.updated_at || '').localeCompare(a?.updated_at || '')) as DocumentApprovalRecord[];
  }
}

export async function fetchApprovalWorkflowDefinitions(): Promise<ApprovalWorkflowDefinition[]> {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DAW_COLLECTIONS.workflows),
      where('module', '==', DAW_MODULE_TAG),
    ));
    if (snap.empty) return [];
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ApprovalWorkflowDefinition));
  } catch {
    return [];
  }
}

export async function saveApprovalWorkflowDefinition(workflow: ApprovalWorkflowDefinition, actor: ApprovalActor): Promise<void> {
  const payload = { ...workflow, module: DAW_MODULE_TAG, updated_at: now() };
  await setDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.workflows, workflow.id), payload, { merge: true });
  for (const step of workflow.steps) {
    await setDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.steps, `${workflow.id}-${step.order}-${step.role}`), {
      workflow_id: workflow.id, module: DAW_MODULE_TAG, ...step, updated_at: now(),
    }, { merge: true });
  }
  await audit(actor, 'WORKFLOW_CREATED', workflow.id, null, payload);
}

export async function syncApprovalsFromDocuments(): Promise<number> {
  const docs = await listDocuments();
  const pendingDocs = docs.filter((d) => d.status === 'pending_approval');
  let created = 0;
  for (const d of pendingDocs) {
    const existing = await getDocs(query(
      collection(getFirebaseFirestore(), DAW_COLLECTIONS.approvals),
      where('document_id', '==', d.id),
      limit(10),
    ));
    const hasOpen = existing.docs.some((docSnap) => {
      const data = docSnap.data();
      if (data.module && data.module !== DAW_MODULE_TAG) return false;
      const s = data.approval_status as string;
      return ['Pending Approval', 'In Progress'].includes(s);
    });
    if (hasOpen) continue;

    const aprNum = await generateApprovalNumber();
    const due = new Date();
    due.setDate(due.getDate() + 7);
    const dueDate = due.toISOString().split('T')[0];

    await addDoc(collection(getFirebaseFirestore(), DAW_COLLECTIONS.approvals), {
      approval_id: aprNum, approval_number: aprNum,
      workflow_id: 'daw-seq-standard', document_id: d.id,
      document_number: d.document_number, document_title: d.document_title,
      document_type: d.document_type, version: d.version,
      approval_type: 'Sequential', current_step: 1, total_steps: 3,
      approver_id: d.approved_by || 'pending', approver_name: d.approved_by_name || 'Pending Assignment',
      approver_role: 'qa_manager', department: d.department, priority: 'Normal',
      due_date: dueDate, approval_date: null, approval_decision: null,
      approval_status: 'Pending Approval', approval_comments: '',
      electronic_signature_required: true, electronic_signature_status: 'Pending',
      delegated_to: null, delegated_to_name: null, escalated: false, escalation_level: 0,
      sla_status: computeApprovalSlaStatus(dueDate, 'Pending Approval'),
      step_id: 'daw-seq-standard-1-qa_manager', started_at: null, module: DAW_MODULE_TAG,
      created_by: d.created_by, created_by_name: d.created_by_name,
      updated_by: d.updated_by, updated_by_name: d.updated_by_name,
      created_at: now(), updated_at: now(),
    });
    created++;
  }
  return created;
}

export async function syncOverdueApprovals(): Promise<number> {
  const records = await listAllApprovals();
  let count = 0;
  for (const r of records) {
    if (['Approved', 'Rejected', 'Cancelled'].includes(r.approval_status)) continue;
    const sla = computeApprovalSlaStatus(r.due_date, r.approval_status, r.approval_date);
    const updates: Partial<DocumentApprovalRecord> & { updated_at?: string } = {};
    if (sla !== r.sla_status) {
      updates.sla_status = sla;
      updates.updated_at = now();
    }
    if (sla === 'Overdue' && !r.escalated) {
      updates.escalated = true;
      updates.escalation_level = (r.escalation_level || 0) + 1;
      await addDoc(collection(getFirebaseFirestore(), DAW_COLLECTIONS.escalations), {
        approval_id: r.id, document_number: r.document_number,
        escalation_level: updates.escalation_level, reason: 'SLA overdue',
        escalated_at: now(), module: DAW_MODULE_TAG,
      });
      await notify('Approval Escalated', `${r.document_number} approval escalated (overdue)`, r.id, ['head_qa', 'qa_manager'], [r.approver_id]);
      await audit({ id: 'system', name: 'System', role: 'system' }, 'ESCALATED', r.id, r.sla_status, sla);
    }
    if (Object.keys(updates).length) {
      await updateDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.approvals, r.id), updates);
      count++;
    }
  }
  return count;
}

function buildApprovalPayload(
  aprNum: string, docRecord: Awaited<ReturnType<typeof getDocumentById>>,
  workflow: ApprovalWorkflowDefinition, input: ApprovalCreateInput, actor: ApprovalActor, timestamp: string,
) {
  const firstStep = workflow.steps[0];
  const esignRequired = firstStep?.e_signature_required ?? false;
  return {
    approval_id: aprNum, approval_number: aprNum,
    workflow_id: input.workflow_id, document_id: docRecord!.id,
    document_number: docRecord!.document_number, document_title: docRecord!.document_title,
    document_type: docRecord!.document_type, version: input.version,
    approval_type: input.approval_type, current_step: 1, total_steps: workflow.steps.length,
    approver_id: input.approver_id, approver_name: input.approver_name,
    approver_role: input.approver_role, department: input.department,
    due_date: input.due_date, approval_date: null, approval_decision: null,
    approval_status: 'Pending Approval', approval_comments: '',
    electronic_signature_required: esignRequired,
    electronic_signature_status: esignRequired ? 'Pending' : 'Not Required',
    delegated_to: null, delegated_to_name: null, escalated: false, escalation_level: 0,
    priority: input.priority, sla_status: computeApprovalSlaStatus(input.due_date, 'Pending Approval'),
    step_id: `${input.workflow_id}-1-${input.approver_role}`, started_at: null, module: DAW_MODULE_TAG,
    created_by: actor.id, created_by_name: actor.name,
    updated_by: actor.id, updated_by_name: actor.name,
    created_at: timestamp, updated_at: timestamp,
  };
}

export async function createApproval(input: ApprovalCreateInput, actor: ApprovalActor): Promise<DocumentApprovalRecord> {
  const docRecord = await getDocumentById(input.document_id);
  if (!docRecord) throw new Error('Document not found');
  if (input.version !== docRecord.version) throw new Error('Version mismatch');

  const openSnap = await getDocs(query(
    collection(getFirebaseFirestore(), DAW_COLLECTIONS.approvals),
    where('document_id', '==', input.document_id),
    limit(10,
    )));
  const hasActive = openSnap.docs.some((d) => {
    const data = d.data();
    return data.module === DAW_MODULE_TAG && ['Pending Approval', 'In Progress'].includes(data.approval_status as string);
  });
  if (hasActive) throw new Error('Document already has an active approval workflow');

  const workflows = await fetchApprovalWorkflowDefinitions();
  const workflow = workflows.find((w) => w.id === input.workflow_id);
  if (!workflow) throw new Error('Workflow not found');

  const aprNum = await generateApprovalNumber();
  const timestamp = now();
  const payload = buildApprovalPayload(aprNum, docRecord, workflow, input, actor, timestamp);

  await updateDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.documents, input.document_id), {
    status: 'pending_approval', updated_at: timestamp, updated_by: actor.id, updated_by_name: actor.name,
  });

  const ref = await addDoc(collection(getFirebaseFirestore(), DAW_COLLECTIONS.approvals), payload);

  if (workflow.approval_type === 'Parallel') {
    for (const step of workflow.steps.filter((s) => s.order === 1)) {
      await addDoc(collection(getFirebaseFirestore(), DAW_COLLECTIONS.approvals), {
        ...payload,
        approval_id: `${aprNum}-${step.role}`, approval_number: `${aprNum}-${step.order}`,
        approver_role: step.role, current_step: step.order,
        step_id: `${workflow.id}-${step.order}-${step.role}`,
        electronic_signature_required: step.e_signature_required,
        electronic_signature_status: step.e_signature_required ? 'Pending' : 'Not Required',
        approval_status: 'Pending Approval',
      });
    }
  }

  await notify('Approval Assigned', `${docRecord.document_number} assigned for approval`, ref.id, [input.approver_role], [input.approver_id]);
  await audit(actor, 'APPROVAL_ASSIGNED', ref.id, null, payload);
  return { id: ref.id, ...payload };
}

export async function startApproval(approvalId: string, actor: ApprovalActor): Promise<DocumentApprovalRecord> {
  const record = await getApprovalById(approvalId);
  if (!record) throw new Error('Approval not found');
  const assignee = record.delegated_to || record.approver_id;
  if (assignee !== actor.id && !['super_admin', 'admin', 'qa_manager', 'head_qa'].includes(actor.role)) {
    throw new Error('Not assigned to this approval');
  }
  const updates = {
    approval_status: 'In Progress', started_at: now(), updated_at: now(),
    updated_by: actor.id, updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.approvals, approvalId), updates);
  await audit(actor, 'APPROVAL_STARTED', approvalId, record.approval_status, 'In Progress');
  return { ...record, ...updates, approval_status: 'In Progress' };
}

export async function delegateApproval(approvalId: string, input: ApprovalDelegateInput, actor: ApprovalActor): Promise<void> {
  const record = await getApprovalById(approvalId);
  if (!record) throw new Error('Approval not found');
  const updates = {
    delegated_to: input.delegate_to_id, delegated_to_name: input.delegate_to_name,
    updated_at: now(), updated_by: actor.id, updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.approvals, approvalId), updates);
  await addDoc(collection(getFirebaseFirestore(), DAW_COLLECTIONS.delegations), {
    approval_id: approvalId, from_id: actor.id, from_name: actor.name,
    to_id: input.delegate_to_id, to_name: input.delegate_to_name,
    reason: input.reason, delegated_at: now(), module: DAW_MODULE_TAG,
  });
  await notify('Approval Delegated', `${record.document_number} delegated to ${input.delegate_to_name}`, approvalId, [], [input.delegate_to_id]);
  await audit(actor, 'DELEGATED', approvalId, record.approver_name, input.delegate_to_name, input.reason);
}

export async function addApprovalComment(approvalId: string, comment: string, actor: ApprovalActor): Promise<void> {
  await addDoc(collection(getFirebaseFirestore(), DAW_COLLECTIONS.comments), {
    approval_id: approvalId, comment, author_id: actor.id, author_name: actor.name, created_at: now(), module: DAW_MODULE_TAG,
  });
  const record = await getApprovalById(approvalId);
  if (record) {
    const combined = record.approval_comments ? `${record.approval_comments}\n${comment}` : comment;
    await updateDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.approvals, approvalId), {
      approval_comments: combined, updated_at: now(),
    });
  }
  await audit(actor, 'COMMENT_ADDED', approvalId, null, comment);
}

async function finalizeDocumentApproval(documentId: string, actor: ApprovalActor): Promise<void> {
  const docRecord = await getDocumentById(documentId);
  if (!docRecord) return;
  await updateDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.documents, documentId), {
    status: 'approved',
    approved_by: actor.id,
    approved_by_name: actor.name,
    updated_at: now(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  });
  await syncEffectiveDocuments();
  await notify('Workflow Completed', `${docRecord.document_number} fully approved`, documentId, ['qa_manager', 'head_qa', 'regulatory_affairs']);
  await audit(actor, 'WORKFLOW_CLOSED', documentId, 'pending_approval', 'approved');
}

async function advanceApprovalWorkflow(completed: DocumentApprovalRecord, actor: ApprovalActor): Promise<boolean> {
  const workflows = await fetchApprovalWorkflowDefinitions();
  const workflow = workflows.find((w) => w.id === completed.workflow_id);
  if (!workflow) return false;

  if (workflow.approval_type === 'Parallel') {
    const siblingSnap = await getDocs(query(
      collection(getFirebaseFirestore(), DAW_COLLECTIONS.approvals),
      where('document_id', '==', completed.document_id),
    ));
    const siblings = siblingSnap.docs
      .map((d) => mapApprovalRaw({ id: d.id, ...d.data() }))
      .filter(Boolean) as DocumentApprovalRecord[];
    const open = siblings.filter((s) => s.id !== completed.id && s.module === DAW_MODULE_TAG);
    const allDone = open.every((s) =>
      s.approval_status === 'Approved' ||
      s.approval_decision === 'Approved' ||
      s.approval_decision === 'Approved With Comments',
    );
    if (!allDone) return false;
    await finalizeDocumentApproval(completed.document_id, actor);
    return true;
  }

  if (completed.current_step >= completed.total_steps) {
    await finalizeDocumentApproval(completed.document_id, actor);
    return true;
  }

  const nextStep = workflow.steps.find((s) => s.order === completed.current_step + 1);
  if (!nextStep) {
    await finalizeDocumentApproval(completed.document_id, actor);
    return true;
  }

  const aprNum = await generateApprovalNumber();
  const due = new Date();
  due.setDate(due.getDate() + (nextStep.due_days || 5));
  const dueDate = due.toISOString().split('T')[0];

  await addDoc(collection(getFirebaseFirestore(), DAW_COLLECTIONS.approvals), {
    approval_id: aprNum, approval_number: aprNum,
    workflow_id: completed.workflow_id, document_id: completed.document_id,
    document_number: completed.document_number, document_title: completed.document_title,
    document_type: completed.document_type, version: completed.version,
    approval_type: completed.approval_type, current_step: nextStep.order, total_steps: completed.total_steps,
    approver_id: 'pending', approver_name: 'Pending Assignment', approver_role: nextStep.role,
    department: completed.department, priority: completed.priority,
    due_date: dueDate, approval_date: null, approval_decision: null,
    approval_status: 'Pending Approval', approval_comments: '',
    electronic_signature_required: nextStep.e_signature_required,
    electronic_signature_status: nextStep.e_signature_required ? 'Pending' : 'Not Required',
    delegated_to: null, delegated_to_name: null, escalated: false, escalation_level: 0,
    sla_status: computeApprovalSlaStatus(dueDate, 'Pending Approval'),
    step_id: `${workflow.id}-${nextStep.order}-${nextStep.role}`, started_at: null, module: DAW_MODULE_TAG,
    created_by: actor.id, created_by_name: actor.name, updated_by: actor.id, updated_by_name: actor.name,
    created_at: now(), updated_at: now(),
  });

  await notify('Approval Assigned', `${completed.document_number} advanced to ${nextStep.name}`, completed.id, [nextStep.role]);
  await audit(actor, 'WORKFLOW_ADVANCED', completed.document_id, completed.current_step, nextStep.order);
  return true;
}

export async function completeApproval(
  approvalId: string, input: ApprovalCompleteInput, actor: ApprovalActor,
): Promise<DocumentApprovalRecord> {
  const record = await getApprovalById(approvalId);
  if (!record) throw new Error('Approval not found');

  if (record.electronic_signature_required && input.decision.startsWith('Approved')) {
    if (!input.esign_record_id) throw new Error('Electronic signature required for this approval step');
  }

  const timestamp = now();
  let newStatus = 'Approved';
  if (input.decision === 'Rejected') newStatus = 'Rejected';
  else if (input.decision === 'Returned For Revision') newStatus = 'Returned';
  else if (input.decision === 'Cancelled') newStatus = 'Cancelled';

  const updates = {
    approval_decision: input.decision,
    approval_status: newStatus,
    approval_date: timestamp,
    approval_comments: input.comments || record.approval_comments,
    electronic_signature_status: input.esign_record_id ? 'Completed' : record.electronic_signature_status,
    sla_status: computeApprovalSlaStatus(record.due_date, newStatus, timestamp),
    updated_at: timestamp, updated_by: actor.id, updated_by_name: actor.name,
  };

  await updateDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.approvals, approvalId), updates);

  if (input.esign_record_id) {
    await addDoc(collection(getFirebaseFirestore(), DAW_COLLECTIONS.esignatures), {
      approval_id: approvalId, document_id: record.document_id, esign_record_id: input.esign_record_id,
      signed_by: actor.id, signed_by_name: actor.name, signed_at: timestamp, module: DAW_MODULE_TAG,
    });
    await audit(actor, 'ELECTRONIC_SIGNATURE_COMPLETED', approvalId, null, input.esign_record_id);
  }

  if (input.comments) {
    await addDoc(collection(getFirebaseFirestore(), DAW_COLLECTIONS.comments), {
      approval_id: approvalId, comment: input.comments, author_id: actor.id, author_name: actor.name, created_at: timestamp, module: DAW_MODULE_TAG,
    });
  }

  const result = { ...record, ...updates, approval_status: newStatus };

  if (newStatus === 'Returned') {
    await updateDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.documents, record.document_id), {
      status: 'returned_for_correction', updated_at: timestamp, updated_by: actor.id, updated_by_name: actor.name,
    });
    await notify('Approval Returned', `${record.document_number} returned for revision`, approvalId, [], [record.created_by]);
    await audit(actor, 'RETURNED', approvalId, record.approval_status, input.comments);
  } else if (newStatus === 'Rejected') {
    await updateDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.documents, record.document_id), {
      status: 'returned_for_correction', updated_at: timestamp, updated_by: actor.id, updated_by_name: actor.name,
    });
    await notify('Approval Rejected', `${record.document_number} rejected`, approvalId, ['qa_manager', 'head_qa']);
    await audit(actor, 'APPROVAL_REJECTED', approvalId, record.approval_status, input.decision, input.comments);
  } else if (newStatus === 'Approved') {
    await notify('Approval Completed', `${record.document_number} step approved`, approvalId, ['qa_manager'], []);
    await audit(actor, 'APPROVAL_COMPLETED', approvalId, record.approval_status, input.decision, input.comments);
    await advanceApprovalWorkflow(result, actor);
  }

  return result;
}

export async function bulkCompleteApprovals(
  approvalIds: string[], decision: ApprovalCompleteInput['decision'], actor: ApprovalActor,
): Promise<number> {
  let count = 0;
  for (const id of approvalIds) {
    try {
      const record = await getApprovalById(id);
      if (!record || !['Pending Approval', 'In Progress'].includes(record.approval_status)) continue;
      if (record.electronic_signature_required && decision.startsWith('Approved')) continue;
      await completeApproval(id, { decision, comments: `Bulk ${decision}` }, actor);
      count++;
    } catch { /* skip failed */ }
  }
  return count;
}

export async function fetchApprovalDashboardData(filters?: ApprovalFilters, actor?: ApprovalActor) {
  await Promise.all([syncApprovalsFromDocuments(), syncOverdueApprovals()]);
  let records = await listAllApprovals();
  const role = actor?.role || '';
  if (canViewAssignedApprovalsOnly(role) && actor?.id) {
    records = records.filter((r) => r.approver_id === actor.id || r.delegated_to === actor.id);
  }
  if (filters) records = filterApprovalRecords(records, filters);
  return { records, metrics: computeApprovalKpis(records), charts: computeApprovalCharts(records) };
}

export async function getApprovalById(id: string): Promise<DocumentApprovalRecord | null> {
  const snap = await getDoc(doc(getFirebaseFirestore(), DAW_COLLECTIONS.approvals, id));
  if (!snap.exists()) return null;
  return mapApprovalRaw({ id: snap.id, ...snap.data() });
}

export async function getApprovalComments(approvalId: string) {
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DAW_COLLECTIONS.comments),
      where('approval_id', '==', approvalId),
      orderBy('created_at', 'asc'),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DAW_COLLECTIONS.comments),
      where('approval_id', '==', approvalId),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

export function exportApprovalsCsv(records: DocumentApprovalRecord[]) {
  downloadCsv('document-approvals.csv',
    ['Approval Number', 'Document', 'Version', 'Approver', 'Department', 'Status', 'Decision', 'Due Date', 'SLA', 'ESign'],
    records.map((r) => [
      r.approval_number, r.document_number, r.version, r.approver_name, r.department,
      r.approval_status, r.approval_decision, r.due_date, r.sla_status, r.electronic_signature_status,
    ]),
  );
}

export function exportApprovalsExcel(records: DocumentApprovalRecord[]) { exportApprovalsCsv(records); }

export async function logApprovalDashboardViewed(actor: ApprovalActor) {
  await audit(actor, 'DASHBOARD_VIEWED', 'approval-dashboard', null, null);
}

export async function logApprovalExported(actor: ApprovalActor, format: string, count: number) {
  await audit(actor, 'APPROVAL_EXPORTED', 'approval-dashboard', null, { format, count });
}

export async function sendApprovalReminders(approvalIds: string[], actor: ApprovalActor): Promise<number> {
  let count = 0;
  for (const id of approvalIds) {
    const r = await getApprovalById(id);
    if (!r || ['Approved', 'Rejected', 'Cancelled'].includes(r.approval_status)) continue;
    const target = r.delegated_to || r.approver_id;
    await notify('Approval Reminder', `Reminder: approve ${r.document_number}`, id, [], [target]);
    await audit(actor, 'REMINDER_SENT', id, null, r.approver_name);
    count++;
  }
  return count;
}

import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { ADMIN_COLLECTIONS, APPROVAL_WORKFLOW_TYPES } from './constants';
import type { Workflow, WorkflowStep, WorkflowFormData } from './schemas';

export interface WorkflowAuditMeta {
  userId: string;
  userName: string;
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function buildWorkflowId(code: string): string {
  return `WF-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function normalizeWorkflow(w: Workflow): Workflow {
  const escalationDays = Number(w.escalationDays ?? w.autoEscalationDays ?? 3);
  return {
    ...w,
    workflowId: w.workflowId || buildWorkflowId(w.workflowCode || w.moduleName || 'WF'),
    workflowCode: w.workflowCode || w.moduleName || '',
    workflowName: w.workflowName || `${w.moduleName} Workflow`,
    workflowType: (w.workflowType as Workflow['workflowType']) || 'Multi Level Approval',
    workflowCategory: w.workflowCategory || 'Approval',
    subModule: w.subModule || '',
    businessUnit: w.businessUnit || '',
    site: w.site || '',
    triggerEvent: w.triggerEvent || '',
    priority: w.priority || 'Medium',
    workflowVersion: w.workflowVersion || '1.0',
    parallelApproval: w.parallelApproval ?? false,
    sequentialApproval: w.sequentialApproval ?? true,
    conditionalRouting: w.conditionalRouting ?? false,
    finalApproverRole: w.finalApproverRole || w.approverRole || '',
    approverRole: w.finalApproverRole || w.approverRole || '',
    reviewerRoles: w.reviewerRoles || w.reviewerRole || '',
    reviewerRole: w.reviewerRoles || w.reviewerRole || '',
    approverRoles: w.approverRoles || '',
    escalationDays,
    autoEscalationDays: escalationDays,
    autoEscalationEnabled: w.autoEscalationEnabled ?? false,
    targetCompletionDays: Number(w.targetCompletionDays ?? 30),
    requireRemarks: w.requireRemarks ?? true,
    allowDelegation: w.allowDelegation ?? false,
    description: w.description || w.workflowChain || '',
    remarks: w.remarks || '',
    isArchived: w.isArchived ?? false,
    isDeleted: Boolean(w.isDeleted),
  };
}

function mapWorkflowDoc(snapshot: { id: string; data: () => Record<string, unknown> }): Workflow {
  return normalizeWorkflow({ id: snapshot.id, ...snapshot.data() } as Workflow);
}

export function isWorkflowActive(w: Workflow): boolean {
  return w.status === 'Active' && !w.isDeleted && !w.isArchived;
}

export function workflowRequiresESign(w: Workflow): boolean {
  return w.requireESignature === true;
}

export function isApprovalWorkflowType(type: string): boolean {
  return APPROVAL_WORKFLOW_TYPES.includes(type as typeof APPROVAL_WORKFLOW_TYPES[number]);
}

export async function fetchWorkflows(includeDeleted = false): Promise<Workflow[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.workflows),
      orderBy('createdAt', 'desc'),
    ));
    return snapshot.docs
      .map((document) => mapWorkflowDoc(document))
      .filter((w) => includeDeleted || !w.isDeleted);
  } catch (error) {
    console.error('fetchWorkflows failed:', error);
    throw new Error('Unable to load workflows. Check your connection and permissions.');
  }
}

export function subscribeToWorkflows(
  includeDeleted: boolean,
  onData: (workflows: Workflow[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const workflowsQuery = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.workflows),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    workflowsQuery,
    (snapshot) => {
      const workflows = snapshot.docs
        .map((document) => mapWorkflowDoc(document))
        .filter((w) => includeDeleted || !w.isDeleted);
      onData(workflows);
    },
    (error) => {
      console.error('subscribeToWorkflows failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to workflows'));
    },
  );
}

export async function fetchWorkflowById(id: string, includeDeleted = false): Promise<Workflow | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.workflows, id));
    if (!snapshot.exists()) return null;
    const workflow = mapWorkflowDoc(snapshot);
    if (workflow.isDeleted && !includeDeleted) return null;
    return workflow;
  } catch (error) {
    console.error('fetchWorkflowById failed:', error);
    throw new Error('Unable to load workflow details.');
  }
}

export async function fetchActiveWorkflowForModule(moduleName: string): Promise<Workflow | null> {
  if (!isFirebaseConfigured() || !moduleName) return null;
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.workflows),
      where('moduleName', '==', moduleName),
      where('status', '==', 'Active'),
      limit(10),
    ));
    const workflows = snapshot.docs
      .map((document) => mapWorkflowDoc(document))
      .filter((w) => isWorkflowActive(w));
    return workflows[0] ?? null;
  } catch {
    const all = await fetchWorkflows();
    return all.find((w) => w.moduleName === moduleName && isWorkflowActive(w)) ?? null;
  }
}

export async function fetchWorkflowSteps(workflowId: string): Promise<WorkflowStep[]> {
  if (!isFirebaseConfigured() || !workflowId) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.workflowSteps),
      where('workflowId', '==', workflowId),
    ));
    return snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() } as WorkflowStep))
      .filter((s) => !s.isDeleted)
      .sort((a, b) => Number(a.stepNumber) - Number(b.stepNumber));
  } catch (error) {
    console.error('fetchWorkflowSteps failed:', error);
    return [];
  }
}

export function getWorkflowSummaryCounts(workflows: Workflow[]) {
  const active = workflows.filter((w) => !w.isDeleted);
  return {
    total: active.length,
    active: active.filter((w) => w.status === 'Active').length,
    inactive: active.filter((w) => w.status === 'Inactive').length,
    multiLevel: active.filter((w) => w.workflowType === 'Multi Level Approval').length,
    eSignRequired: active.filter((w) => w.requireESignature).length,
    escalationEnabled: active.filter((w) => w.autoEscalationEnabled).length,
    archived: active.filter((w) => w.isArchived).length,
  };
}

export function canDeleteWorkflowRecord(workflow: Workflow): { allowed: boolean; reason?: string } {
  if (workflow.isDeleted) return { allowed: false, reason: 'Workflow is already deleted.' };
  if (workflow.status === 'Active') {
    return { allowed: false, reason: 'Deactivate workflow before deleting.' };
  }
  return { allowed: true };
}

export async function createWorkflow(
  data: WorkflowFormData,
  _meta: WorkflowAuditMeta,
): Promise<{ workflow: Workflow | null; error: string | null }> {
  try {
    const createFn = httpsCallable<Record<string, unknown>, Workflow>(
      getFirebaseFunctions(),
      'createAdminWorkflow',
    );
    const response = await createFn({
      ...data,
      reason: data.changeReason || 'Initial workflow registration',
    });
    return { workflow: normalizeWorkflow(response.data), error: null };
  } catch (error) {
    return { workflow: null, error: callableErrorMessage(error, 'Unable to create workflow') };
  }
}

export async function updateWorkflow(
  id: string,
  data: WorkflowFormData,
  _existing: Workflow,
  _meta: WorkflowAuditMeta,
): Promise<{ workflow: Workflow | null; error: string | null }> {
  try {
    const updateFn = httpsCallable<
      Record<string, unknown>,
      { workflow: Workflow }
    >(getFirebaseFunctions(), 'updateAdminWorkflow');
    const response = await updateFn({
      workflowDocId: id,
      updates: data,
      reason: data.changeReason,
    });
    return { workflow: normalizeWorkflow(response.data.workflow), error: null };
  } catch (error) {
    return { workflow: null, error: callableErrorMessage(error, 'Unable to update workflow') };
  }
}

export async function setWorkflowStatus(
  id: string,
  _workflow: Workflow,
  status: 'Active' | 'Inactive',
  _meta: WorkflowAuditMeta,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'setAdminWorkflowStatus');
    await fn({ workflowDocId: id, workflowStatus: status, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update workflow status') };
  }
}

export async function archiveWorkflow(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'archiveAdminWorkflow');
    await fn({ workflowDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to archive workflow') };
  }
}

export async function deleteWorkflow(
  id: string,
  workflow: Workflow,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const check = canDeleteWorkflowRecord(workflow);
  if (!check.allowed) return { success: false, error: check.reason };
  try {
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminWorkflow');
    await deleteFn({ workflowDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete workflow') };
  }
}

export async function restoreWorkflow(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const restoreFn = httpsCallable(getFirebaseFunctions(), 'restoreAdminWorkflow');
    await restoreFn({ workflowDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to restore workflow') };
  }
}

export async function copyWorkflow(
  sourceId: string,
  newCode: string,
  newName: string,
  _meta: WorkflowAuditMeta,
  reason = 'Clone workflow',
): Promise<{ workflow: Workflow | null; error: string | null }> {
  try {
    const cloneFn = httpsCallable<Record<string, unknown>, Workflow>(
      getFirebaseFunctions(),
      'cloneAdminWorkflow',
    );
    const response = await cloneFn({
      sourceWorkflowDocId: sourceId,
      newCode,
      newName,
      reason,
    });
    return { workflow: normalizeWorkflow(response.data), error: null };
  } catch (error) {
    return { workflow: null, error: callableErrorMessage(error, 'Unable to clone workflow') };
  }
}

export async function bulkUpdateWorkflows(
  workflowIds: string[],
  action: 'activate' | 'deactivate' | 'archive',
  reason: string,
): Promise<{ successCount: number; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number }
    >(getFirebaseFunctions(), 'bulkUpdateAdminWorkflows');
    const response = await bulkFn({ workflowDocIds: workflowIds, action, reason });
    return { successCount: response.data.successCount };
  } catch (error) {
    return { successCount: 0, error: callableErrorMessage(error, 'Bulk update failed') };
  }
}

export async function bulkDeleteWorkflows(
  workflowIds: string[],
  reason: string,
): Promise<{ successCount: number; errors: string[]; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'bulkSoftDeleteAdminWorkflows');
    const response = await bulkFn({ workflowDocIds: workflowIds, reason });
    return response.data;
  } catch (error) {
    return { successCount: 0, errors: [], error: callableErrorMessage(error, 'Bulk delete failed') };
  }
}

export async function validateWorkflowDesign(
  data: Partial<WorkflowFormData>,
): Promise<{ valid: boolean; errors: string[]; warnings: string[]; chain: string }> {
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { valid: boolean; errors: string[]; warnings: string[]; chain: string }
    >(getFirebaseFunctions(), 'validateAdminWorkflowDesign');
    const response = await fn(data);
    return response.data;
  } catch (error) {
    return {
      valid: false,
      errors: [callableErrorMessage(error, 'Validation failed')],
      warnings: [],
      chain: '',
    };
  }
}

export async function fetchWorkflowAuditTrail(recordId: string) {
  if (!isFirebaseConfigured() || !recordId) return [];
  try {
    const firestore = getFirebaseFirestore();
    const [trailSnap, logsSnap] = await Promise.all([
      getDocs(query(
        collection(firestore, ADMIN_COLLECTIONS.auditTrail),
        where('documentId', '==', recordId),
        orderBy('timestamp', 'desc'),
        limit(30),
      )).catch(() => ({ docs: [] })),
      getDocs(query(
        collection(firestore, ADMIN_COLLECTIONS.auditLogs),
        where('recordId', '==', recordId),
        orderBy('dateTime', 'desc'),
        limit(30),
      )).catch(() => ({ docs: [] })),
    ]);
    return [...trailSnap.docs, ...logsSnap.docs]
      .map((document): Record<string, unknown> & { id: string } => {
        const data = document.data() as Record<string, unknown>;
        return { id: document.id, ...data };
      })
      .sort((a, b) => String(b.timestamp ?? b.dateTime).localeCompare(String(a.timestamp ?? a.dateTime)))
      .slice(0, 30);
  } catch (error) {
    console.error('fetchWorkflowAuditTrail failed:', error);
    return [];
  }
}

export async function countLinkedWorkflowUsage(workflowId: string, workflowCode: string): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  const firestore = getFirebaseFirestore();
  const collections = [
    'deviations', 'capa_records', 'change_controls', 'oos_records', 'pqr_records', 'documents',
  ];
  let total = 0;
  for (const name of collections) {
    try {
      const snap = await getDocs(query(
        collection(firestore, name),
        where('workflowCode', '==', workflowCode),
        limit(3),
      ));
      total += snap.docs.filter((d) => d.data().isDeleted !== true).length;
    } catch {
      // skip
    }
  }
  if (workflowId) {
    try {
      const snap = await getDocs(query(
        collection(firestore, 'deviations'),
        where('workflowId', '==', workflowId),
        limit(3),
      ));
      total += snap.docs.length;
    } catch {
      // skip
    }
  }
  return total;
}

export function exportWorkflowsCsv(workflows: Workflow[]): string {
  const headers = [
    'Code', 'Name', 'Module', 'Sub Module', 'Category', 'Type', 'Version',
    'Priority', 'Levels', 'Site', 'Business Unit', 'Status', 'E-Sign', 'Escalation', 'Archived',
  ];
  const rows = workflows.map((w) => [
    w.workflowCode, w.workflowName, w.moduleName, w.subModule, w.workflowCategory,
    w.workflowType, w.workflowVersion, w.priority, w.approvalLevels, w.site, w.businessUnit,
    w.status, w.requireESignature ? 'Yes' : 'No',
    w.autoEscalationEnabled ? 'Yes' : 'No', w.isArchived ? 'Yes' : 'No',
  ]);
  return [headers.join(','), ...rows.map((row) =>
    row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','),
  )].join('\n');
}

export async function logWorkflowExport(meta: WorkflowAuditMeta, count: number, reason = 'Workflow list export') {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminWorkflowExport');
    await fn({ count, reason, userId: meta.userId });
  } catch (error) {
    console.error('logWorkflowExport failed:', error);
  }
}

function rowToImportWorkflow(cols: string[], headers: string[]): Record<string, string> | null {
  const idx = (name: string) => headers.findIndex((h) => h.includes(name));
  const code = cols[idx('code')] || '';
  const name = cols[idx('name')] || '';
  if (!code || !name) return null;
  return {
    workflowCode: code,
    workflowName: name,
    moduleName: cols[idx('module')] || 'PQR',
    workflowType: cols[idx('type')] || 'Multi Level Approval',
    department: cols[idx('department')] || 'QA',
    finalApproverRole: cols[idx('approver')] || 'head_qa',
    initiatorRole: cols[idx('initiator')] || 'qa_executive',
  };
}

export async function importWorkflowsFromFile(
  file: File,
  meta: WorkflowAuditMeta,
  reason = 'CSV workflow import',
): Promise<{ imported: number; errors: string[] }> {
  const text = await file.text();
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { imported: 0, errors: ['No data rows found'] };

  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.match(/("([^"]|"")*"|[^,]*)/g)?.map((c) =>
      c.replace(/^"|"$/g, '').replace(/""/g, '"').trim(),
    ) || [];
    const row = rowToImportWorkflow(cols, headers);
    if (row) rows.push(row);
  }
  if (!rows.length) return { imported: 0, errors: ['No valid rows found'] };

  try {
    const importFn = httpsCallable<
      Record<string, unknown>,
      { imported: number; errors: string[] }
    >(getFirebaseFunctions(), 'importAdminWorkflows');
    const response = await importFn({ rows, reason, userId: meta.userId });
    return response.data;
  } catch (error) {
    return { imported: 0, errors: [callableErrorMessage(error, 'Import failed')] };
  }
}

type StepDef = {
  stepName: string;
  stepType: WorkflowStep['stepType'];
  assignedRole: string;
  department?: string;
  canApprove?: boolean;
  canReject?: boolean;
  requireESignature?: boolean;
};

function makeSteps(defs: StepDef[]): WorkflowFormData['steps'] {
  return defs.map((d, i) => ({
    stepNumber: i + 1,
    stepName: d.stepName,
    stepType: d.stepType,
    department: d.department || 'QA',
    assignedRole: d.assignedRole,
    assignedUser: '',
    isMandatory: true,
    canApprove: d.canApprove ?? d.stepType.includes('Approve'),
    canReject: d.canReject ?? false,
    canSendBack: true,
    requireESignature: d.requireESignature ?? d.stepType.includes('Approve'),
    requireComment: true,
    dueDays: 3,
    escalationRole: 'head_qa',
    conditionExpression: '',
    nextStepOnApprove: '',
    nextStepOnReject: '',
    isParallel: false,
    status: 'Active' as const,
  }));
}

export const DEFAULT_WORKFLOW_PRESETS: Array<{
  code: string;
  name: string;
  moduleName: WorkflowFormData['moduleName'];
  workflowType: WorkflowFormData['workflowType'];
  steps: WorkflowFormData['steps'];
  finalApproverRole: string;
}> = [
  {
    code: 'PQR-DEFAULT',
    name: 'PQR Review Workflow',
    moduleName: 'PQR',
    workflowType: 'Multi Level Approval',
    finalApproverRole: 'head_qa',
    steps: makeSteps([
      { stepName: 'QA Executive', stepType: 'Review', assignedRole: 'qa_executive', department: 'QA' },
      { stepName: 'QA Manager', stepType: 'Review', assignedRole: 'qa_manager', department: 'QA' },
      { stepName: 'QC Manager', stepType: 'Review', assignedRole: 'qc_manager', department: 'QC' },
      { stepName: 'Production Manager', stepType: 'Review', assignedRole: 'production_manager', department: 'Production' },
      { stepName: 'Warehouse Manager', stepType: 'Review', assignedRole: 'warehouse_manager', department: 'Warehouse' },
      { stepName: 'Engineering Manager', stepType: 'Review', assignedRole: 'engineering_manager', department: 'Engineering' },
      { stepName: 'Head QA', stepType: 'Final Approve', assignedRole: 'head_qa', department: 'QA', canApprove: true, canReject: true, requireESignature: true },
    ]),
  },
  {
    code: 'DEV-DEFAULT',
    name: 'Deviation Workflow',
    moduleName: 'Deviation',
    workflowType: 'Investigation + Approval',
    finalApproverRole: 'head_qa',
    steps: makeSteps([
      { stepName: 'Initiator', stepType: 'Submit', assignedRole: 'qa_executive' },
      { stepName: 'Department Head', stepType: 'Review', assignedRole: 'department_head' },
      { stepName: 'QA Review', stepType: 'Review', assignedRole: 'qa_manager' },
      { stepName: 'Investigation', stepType: 'Investigate', assignedRole: 'qa_executive' },
      { stepName: 'CAPA if required', stepType: 'Execute', assignedRole: 'qa_manager' },
      { stepName: 'Head QA Approval', stepType: 'Final Approve', assignedRole: 'head_qa', canApprove: true, canReject: true },
      { stepName: 'Close', stepType: 'Close', assignedRole: 'qa_manager' },
    ]),
  },
  {
    code: 'OOS-DEFAULT',
    name: 'OOS Workflow',
    moduleName: 'OOS',
    workflowType: 'Investigation + Approval',
    finalApproverRole: 'head_qa',
    steps: makeSteps([
      { stepName: 'QC Analyst', stepType: 'Submit', assignedRole: 'qc_executive', department: 'QC' },
      { stepName: 'QC Manager', stepType: 'Review', assignedRole: 'qc_manager', department: 'QC' },
      { stepName: 'QA Review', stepType: 'Review', assignedRole: 'qa_manager' },
      { stepName: 'Phase-I', stepType: 'Investigate', assignedRole: 'qc_manager' },
      { stepName: 'Phase-II', stepType: 'Investigate', assignedRole: 'qa_manager' },
      { stepName: 'Head QA Approval', stepType: 'Final Approve', assignedRole: 'head_qa', canApprove: true },
      { stepName: 'Close', stepType: 'Close', assignedRole: 'qa_manager' },
    ]),
  },
  {
    code: 'CAPA-DEFAULT',
    name: 'CAPA Workflow',
    moduleName: 'CAPA',
    workflowType: 'Execution + Review + Approval',
    finalApproverRole: 'head_qa',
    steps: makeSteps([
      { stepName: 'QA Create', stepType: 'Prepare', assignedRole: 'qa_executive' },
      { stepName: 'Implementation', stepType: 'Execute', assignedRole: 'production_manager' },
      { stepName: 'Effectiveness Check', stepType: 'Verify', assignedRole: 'qa_manager' },
      { stepName: 'Head QA Approval', stepType: 'Final Approve', assignedRole: 'head_qa', canApprove: true },
      { stepName: 'Close', stepType: 'Close', assignedRole: 'qa_manager' },
    ]),
  },
  {
    code: 'CC-DEFAULT',
    name: 'Change Control Workflow',
    moduleName: 'Change Control',
    workflowType: 'Execution + Review + Approval',
    finalApproverRole: 'head_qa',
    steps: makeSteps([
      { stepName: 'Initiator', stepType: 'Submit', assignedRole: 'qa_executive' },
      { stepName: 'QA Review', stepType: 'Review', assignedRole: 'qa_manager' },
      { stepName: 'Impact Assessment', stepType: 'Review', assignedRole: 'qa_manager' },
      { stepName: 'Department Reviews', stepType: 'Review', assignedRole: 'department_head' },
      { stepName: 'Head QA Approval', stepType: 'Approve', assignedRole: 'head_qa', canApprove: true },
      { stepName: 'Implementation', stepType: 'Execute', assignedRole: 'production_manager' },
      { stepName: 'Effectiveness', stepType: 'Verify', assignedRole: 'qa_manager' },
      { stepName: 'Close', stepType: 'Close', assignedRole: 'qa_manager' },
    ]),
  },
  {
    code: 'DMS-DEFAULT',
    name: 'DMS Workflow',
    moduleName: 'DMS',
    workflowType: 'Sequential Review',
    finalApproverRole: 'head_qa',
    steps: makeSteps([
      { stepName: 'Author', stepType: 'Prepare', assignedRole: 'qa_executive' },
      { stepName: 'Reviewer', stepType: 'Review', assignedRole: 'qa_manager' },
      { stepName: 'Approver', stepType: 'Approve', assignedRole: 'head_qa', canApprove: true },
      { stepName: 'Effective', stepType: 'Close', assignedRole: 'qa_manager' },
    ]),
  },
];

export async function seedDefaultWorkflows(
  meta: WorkflowAuditMeta,
  reason = 'Seed default QMS workflows',
): Promise<{ created: number; skipped: number }> {
  const presets: WorkflowFormData[] = DEFAULT_WORKFLOW_PRESETS.map((preset) => ({
    workflowCode: preset.code,
    workflowName: preset.name,
    moduleName: preset.moduleName,
    subModule: '',
    workflowCategory: 'Approval',
    businessUnit: '',
    site: '',
    department: 'QA',
    workflowType: preset.workflowType,
    triggerEvent: `${preset.moduleName} Created`,
    priority: 'High',
    slaHours: undefined,
    parallelApproval: false,
    sequentialApproval: true,
    conditionalRouting: false,
    workflowVersion: '1.0',
    effectiveDate: '',
    reviewDate: '',
    expiryDate: '',
    initiatorRole: preset.steps[0]?.assignedRole || 'qa_executive',
    reviewerRoles: preset.steps.filter((s) => s.stepType === 'Review').map((s) => s.assignedRole).join(','),
    approverRoles: preset.steps.filter((s) => s.stepType === 'Approve' || s.stepType === 'Final Approve').map((s) => s.assignedRole).join(','),
    finalApproverRole: preset.finalApproverRole,
    escalationRole: 'head_qa',
    approvalLevels: preset.steps.length,
    requireESignature: true,
    requireRemarks: true,
    allowRejection: true,
    allowResubmission: true,
    allowDelegation: false,
    autoEscalationEnabled: true,
    escalationDays: 3,
    targetCompletionDays: 30,
    description: `Default ${preset.moduleName} workflow`,
    remarks: '',
    changeReason: reason,
    steps: preset.steps,
  }));

  try {
    const seedFn = httpsCallable<
      Record<string, unknown>,
      { created: number; skipped: number }
    >(getFirebaseFunctions(), 'seedAdminDefaultWorkflows');
    const response = await seedFn({ presets, reason, userId: meta.userId });
    return response.data;
  } catch (error) {
    console.error('seedDefaultWorkflows failed:', error);
    return { created: 0, skipped: presets.length };
  }
}

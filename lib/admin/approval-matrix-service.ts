import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { ADMIN_COLLECTIONS } from './constants';
import type { ApprovalMatrix, ApprovalMatrixFormData } from './schemas';

export interface ApprovalMatrixAuditMeta {
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

export function buildMatrixId(code: string): string {
  return `AMX-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function normalizeApprovalMatrix(m: ApprovalMatrix): ApprovalMatrix {
  const prepared = m.preparedByRole || m.level1Reviewer || '';
  const reviewed = m.reviewedByRole || m.level2Reviewer || '';
  const finalAp = m.finalApproverRole || m.finalApprover || '';
  return {
    ...m,
    approvalMatrixId: m.approvalMatrixId || m.matrixId || buildMatrixId(m.matrixCode || m.module || 'MATRIX'),
    matrixId: m.approvalMatrixId || m.matrixId || buildMatrixId(m.matrixCode || ''),
    moduleName: m.moduleName || m.module || '',
    module: m.moduleName || m.module || '',
    subModule: m.subModule || '',
    businessUnit: m.businessUnit || '',
    workflowCode: m.workflowCode || '',
    documentType: m.documentType || '',
    category: m.category || '',
    priority: m.priority || 'Medium',
    description: m.description || '',
    approvalMode: m.approvalMode || (m.parallelApprovalAllowed ? 'Parallel' : 'Sequential'),
    matrixVersion: m.matrixVersion || '1.0',
    preparedByRole: prepared,
    level1Reviewer: prepared,
    reviewedByRole: reviewed,
    level2Reviewer: reviewed,
    finalApproverRole: finalAp,
    finalApprover: finalAp,
    eSignatureRequired: m.eSignatureRequired ?? m.eSignRequired ?? true,
    eSignRequired: m.eSignatureRequired ?? m.eSignRequired ?? true,
    digitalSignatureRequired: m.digitalSignatureRequired ?? false,
    approvalCommentRequired: m.approvalCommentRequired ?? m.mandatoryRemarks ?? true,
    mandatoryRemarks: m.approvalCommentRequired ?? m.mandatoryRemarks ?? true,
    minimumApprovalLevel: Number(m.minimumApprovalLevel ?? 1),
    parallelApprovalAllowed: m.parallelApprovalAllowed ?? false,
    sequentialApprovalRequired: m.sequentialApprovalRequired ?? true,
    conditionalApprovalEnabled: m.conditionalApprovalEnabled ?? false,
    delegationAllowed: m.delegationAllowed ?? false,
    allowReject: m.allowReject ?? true,
    allowReturn: m.allowReturn ?? true,
    allowRework: m.allowRework ?? true,
    allowResubmit: m.allowResubmit ?? true,
    autoEscalationEnabled: m.autoEscalationEnabled ?? false,
    riskLevel: (m.riskLevel as ApprovalMatrix['riskLevel']) || 'Medium',
    isArchived: m.isArchived ?? false,
    isDeleted: Boolean(m.isDeleted),
  };
}

function mapMatrixDoc(snapshot: { id: string; data: () => Record<string, unknown> }): ApprovalMatrix {
  return normalizeApprovalMatrix({ id: snapshot.id, ...snapshot.data() } as ApprovalMatrix);
}

export function isMatrixActive(m: ApprovalMatrix): boolean {
  return m.status === 'Active' && !m.isDeleted && !m.isArchived;
}

export function matrixRequiresESign(m: ApprovalMatrix): boolean {
  return m.eSignatureRequired === true;
}

export function matrixRequiresComment(m: ApprovalMatrix): boolean {
  return m.approvalCommentRequired === true;
}

export async function fetchApprovalMatrices(includeDeleted = false): Promise<ApprovalMatrix[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.approvalMatrix),
      orderBy('createdAt', 'desc'),
    ));
    return snapshot.docs
      .map((document) => mapMatrixDoc(document))
      .filter((m) => includeDeleted || !m.isDeleted);
  } catch (error) {
    console.error('fetchApprovalMatrices failed:', error);
    throw new Error('Unable to load approval matrices. Check your connection and permissions.');
  }
}

export function subscribeToApprovalMatrices(
  includeDeleted: boolean,
  onData: (matrices: ApprovalMatrix[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const matricesQuery = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.approvalMatrix),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    matricesQuery,
    (snapshot) => {
      const matrices = snapshot.docs
        .map((document) => mapMatrixDoc(document))
        .filter((m) => includeDeleted || !m.isDeleted);
      onData(matrices);
    },
    (error) => {
      console.error('subscribeToApprovalMatrices failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to approval matrices'));
    },
  );
}

export async function fetchApprovalMatrixById(id: string, includeDeleted = false): Promise<ApprovalMatrix | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.approvalMatrix, id));
    if (!snapshot.exists()) return null;
    const matrix = mapMatrixDoc(snapshot);
    if (matrix.isDeleted && !includeDeleted) return null;
    return matrix;
  } catch (error) {
    console.error('fetchApprovalMatrixById failed:', error);
    throw new Error('Unable to load approval matrix details.');
  }
}

export async function fetchActiveMatrixForModule(
  moduleName: string,
  department?: string,
  riskLevel?: string,
): Promise<ApprovalMatrix | null> {
  if (!isFirebaseConfigured() || !moduleName) return null;
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.approvalMatrix),
      where('moduleName', '==', moduleName),
      where('status', '==', 'Active'),
      limit(20),
    ));
    const matrices = snapshot.docs
      .map((document) => mapMatrixDoc(document))
      .filter((m) => isMatrixActive(m));
    return matrices.find((m) =>
      (!department || m.department === department || m.department === 'All')
      && (!riskLevel || m.riskLevel === riskLevel || m.riskLevel === 'All'),
    ) ?? matrices[0] ?? null;
  } catch {
    const all = await fetchApprovalMatrices();
    return all.find((m) =>
      isMatrixActive(m)
      && m.moduleName === moduleName
      && (!department || m.department === department || m.department === 'All')
      && (!riskLevel || m.riskLevel === riskLevel || m.riskLevel === 'All'),
    ) ?? null;
  }
}

export function getApprovalMatrixSummaryCounts(matrices: ApprovalMatrix[]) {
  const active = matrices.filter((m) => !m.isDeleted);
  return {
    total: active.length,
    active: active.filter((m) => m.status === 'Active').length,
    inactive: active.filter((m) => m.status === 'Inactive').length,
    critical: active.filter((m) => m.riskLevel === 'Critical').length,
    eSignRequired: active.filter((m) => m.eSignatureRequired).length,
    departmentWise: active.filter((m) => m.department && m.department !== 'All').length,
    productSpecific: active.filter((m) => m.productOptional?.trim()).length,
    archived: active.filter((m) => m.isArchived).length,
  };
}

export function buildApprovalFlow(m: ApprovalMatrix): Array<{ label: string; roles: string }> {
  const flow: Array<{ label: string; roles: string }> = [];
  if (m.preparedByRole) flow.push({ label: 'Prepared By', roles: m.preparedByRole });
  if (m.reviewedByRole) flow.push({ label: 'Reviewed By', roles: m.reviewedByRole });
  if (m.verifiedByRole) flow.push({ label: 'Verified By', roles: m.verifiedByRole });
  if (m.approvedByRole) flow.push({ label: 'Approved By', roles: m.approvedByRole });
  if (m.finalApproverRole) flow.push({ label: 'Final Approver', roles: m.finalApproverRole });
  return flow;
}

export function canDeleteMatrixRecord(matrix: ApprovalMatrix): { allowed: boolean; reason?: string } {
  if (matrix.isDeleted) return { allowed: false, reason: 'Matrix is already deleted.' };
  if (matrix.status === 'Active') {
    return { allowed: false, reason: 'Deactivate matrix before deleting.' };
  }
  return { allowed: true };
}

export async function createApprovalMatrix(
  data: ApprovalMatrixFormData,
  _meta: ApprovalMatrixAuditMeta,
): Promise<{ matrix: ApprovalMatrix | null; error: string | null }> {
  try {
    const createFn = httpsCallable<Record<string, unknown>, ApprovalMatrix>(
      getFirebaseFunctions(),
      'createAdminApprovalMatrix',
    );
    const response = await createFn({
      ...data,
      reason: data.changeReason || 'Initial approval matrix registration',
    });
    return { matrix: normalizeApprovalMatrix(response.data), error: null };
  } catch (error) {
    return { matrix: null, error: callableErrorMessage(error, 'Unable to create approval matrix') };
  }
}

export async function updateApprovalMatrix(
  id: string,
  data: ApprovalMatrixFormData,
  _existing: ApprovalMatrix,
  _meta: ApprovalMatrixAuditMeta,
): Promise<{ matrix: ApprovalMatrix | null; error: string | null }> {
  try {
    const updateFn = httpsCallable<
      Record<string, unknown>,
      { matrix: ApprovalMatrix }
    >(getFirebaseFunctions(), 'updateAdminApprovalMatrix');
    const response = await updateFn({
      matrixDocId: id,
      updates: data,
      reason: data.changeReason,
    });
    return { matrix: normalizeApprovalMatrix(response.data.matrix), error: null };
  } catch (error) {
    return { matrix: null, error: callableErrorMessage(error, 'Unable to update approval matrix') };
  }
}

export async function setApprovalMatrixStatus(
  id: string,
  _matrix: ApprovalMatrix,
  status: 'Active' | 'Inactive',
  _meta: ApprovalMatrixAuditMeta,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'setAdminApprovalMatrixStatus');
    await fn({ matrixDocId: id, matrixStatus: status, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update matrix status') };
  }
}

export async function archiveApprovalMatrix(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'archiveAdminApprovalMatrix');
    await fn({ matrixDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to archive matrix') };
  }
}

export async function deleteApprovalMatrix(
  id: string,
  matrix: ApprovalMatrix,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const check = canDeleteMatrixRecord(matrix);
  if (!check.allowed) return { success: false, error: check.reason };
  try {
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminApprovalMatrix');
    await deleteFn({ matrixDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete matrix') };
  }
}

export async function restoreApprovalMatrix(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const restoreFn = httpsCallable(getFirebaseFunctions(), 'restoreAdminApprovalMatrix');
    await restoreFn({ matrixDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to restore matrix') };
  }
}

export async function copyApprovalMatrix(
  sourceId: string,
  newCode: string,
  newName: string,
  _meta: ApprovalMatrixAuditMeta,
  reason = 'Clone approval matrix',
): Promise<{ matrix: ApprovalMatrix | null; error: string | null }> {
  try {
    const cloneFn = httpsCallable<Record<string, unknown>, ApprovalMatrix>(
      getFirebaseFunctions(),
      'cloneAdminApprovalMatrix',
    );
    const response = await cloneFn({
      sourceMatrixDocId: sourceId,
      newCode,
      newName,
      reason,
    });
    return { matrix: normalizeApprovalMatrix(response.data), error: null };
  } catch (error) {
    return { matrix: null, error: callableErrorMessage(error, 'Unable to clone matrix') };
  }
}

export async function bulkUpdateApprovalMatrices(
  matrixIds: string[],
  action: 'activate' | 'deactivate' | 'archive',
  reason: string,
): Promise<{ successCount: number; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number }
    >(getFirebaseFunctions(), 'bulkUpdateAdminApprovalMatrices');
    const response = await bulkFn({ matrixDocIds: matrixIds, action, reason });
    return { successCount: response.data.successCount };
  } catch (error) {
    return { successCount: 0, error: callableErrorMessage(error, 'Bulk update failed') };
  }
}

export async function bulkDeleteApprovalMatrices(
  matrixIds: string[],
  reason: string,
): Promise<{ successCount: number; errors: string[]; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'bulkSoftDeleteAdminApprovalMatrices');
    const response = await bulkFn({ matrixDocIds: matrixIds, reason });
    return response.data;
  } catch (error) {
    return { successCount: 0, errors: [], error: callableErrorMessage(error, 'Bulk delete failed') };
  }
}

export async function fetchApprovalMatrixAuditTrail(recordId: string) {
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
    console.error('fetchApprovalMatrixAuditTrail failed:', error);
    return [];
  }
}

export async function countLinkedMatrixUsage(matrixId: string, matrixCode: string): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  const firestore = getFirebaseFirestore();
  const collections = ['deviations', 'capa_records', 'change_controls', 'oos_records', 'pqr_records', 'documents'];
  let total = 0;
  for (const name of collections) {
    try {
      const snap = await getDocs(query(
        collection(firestore, name),
        where('matrixCode', '==', matrixCode),
        limit(3),
      ));
      total += snap.docs.filter((d) => d.data().isDeleted !== true).length;
    } catch {
      // skip
    }
  }
  if (matrixId) {
    try {
      const snap = await getDocs(query(
        collection(firestore, 'approval_requests'),
        where('approvalMatrixId', '==', matrixId),
        limit(3),
      ));
      total += snap.docs.length;
    } catch {
      // skip
    }
  }
  return total;
}

export function exportApprovalMatricesCsv(matrices: ApprovalMatrix[]): string {
  const headers = [
    'Code', 'Name', 'Module', 'Sub Module', 'Department', 'Site', 'Business Unit',
    'Risk', 'Mode', 'Version', 'Final Approver', 'E-Sign', 'Workflow', 'Status', 'Archived',
  ];
  const rows = matrices.map((m) => [
    m.matrixCode, m.matrixName, m.moduleName, m.subModule, m.department, m.siteLocation,
    m.businessUnit, m.riskLevel, m.approvalMode, m.matrixVersion, m.finalApproverRole,
    m.eSignatureRequired ? 'Yes' : 'No', m.workflowCode, m.status, m.isArchived ? 'Yes' : 'No',
  ]);
  return [headers.join(','), ...rows.map((row) =>
    row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','),
  )].join('\n');
}

export async function logApprovalMatrixExport(
  meta: ApprovalMatrixAuditMeta,
  count: number,
  reason = 'Approval matrix list export',
) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminApprovalMatrixExport');
    await fn({ count, reason, userId: meta.userId });
  } catch (error) {
    console.error('logApprovalMatrixExport failed:', error);
  }
}

function rowToImportMatrix(cols: string[], headers: string[]): Record<string, string> | null {
  const idx = (name: string) => headers.findIndex((h) => h.includes(name));
  const code = cols[idx('code')] || '';
  const name = cols[idx('name')] || '';
  if (!code || !name) return null;
  return {
    matrixCode: code,
    matrixName: name,
    moduleName: cols[idx('module')] || 'PQR',
    department: cols[idx('department')] || 'QA',
    riskLevel: cols[idx('risk')] || 'Medium',
    finalApproverRole: cols[idx('approver')] || cols[idx('final')] || 'head_qa',
    preparedByRole: cols[idx('prepared')] || 'qa_executive',
    reviewedByRole: cols[idx('reviewed')] || 'qa_manager',
  };
}

export async function importApprovalMatricesFromFile(
  file: File,
  meta: ApprovalMatrixAuditMeta,
  reason = 'CSV approval matrix import',
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
    const row = rowToImportMatrix(cols, headers);
    if (row) rows.push(row);
  }
  if (!rows.length) return { imported: 0, errors: ['No valid rows found'] };

  try {
    const importFn = httpsCallable<
      Record<string, unknown>,
      { imported: number; errors: string[] }
    >(getFirebaseFunctions(), 'importAdminApprovalMatrices');
    const response = await importFn({ rows, reason, userId: meta.userId });
    return response.data;
  } catch (error) {
    return { imported: 0, errors: [callableErrorMessage(error, 'Import failed')] };
  }
}

export const DEFAULT_APPROVAL_MATRIX_PRESETS: ApprovalMatrixFormData[] = [
  {
    matrixCode: 'PQR-DEFAULT', matrixName: 'PQR Approval Matrix', description: 'Default PQR matrix',
    moduleName: 'PQR', subModule: '', department: 'QA', siteLocation: '', businessUnit: '',
    workflowCode: 'PQR-DEFAULT', documentType: '', category: 'Quality', priority: 'High',
    productOptional: '', processOptional: '', riskLevel: 'High', approvalMode: 'Parallel',
    matrixVersion: '1.0', effectiveDate: '', reviewDate: '',
    preparedByRole: 'qa_executive',
    reviewedByRole: 'qa_manager,qc_manager,production_manager,warehouse_manager,engineering_manager',
    verifiedByRole: '', approvedByRole: '', finalApproverRole: 'head_qa',
    escalationRole: 'head_qa', approvalGroup: '', quorumCount: undefined, minimumApprovalLevel: 2,
    slaHours: 72, reminderHours: 24, autoEscalationEnabled: true, autoEscalationHours: 48,
    autoApproveEnabled: false, allowReject: true, allowReturn: true, allowRework: true,
    allowResubmit: true, allowCancel: false, allowSkip: false,
    eSignatureRequired: true, digitalSignatureRequired: false, approvalCommentRequired: true,
    parallelApprovalAllowed: true, sequentialApprovalRequired: false,
    conditionalApprovalEnabled: false, conditionExpression: '',
    delegationAllowed: false, remarks: 'Default PQR matrix', changeReason: 'Seed default',
  },
  {
    matrixCode: 'DEV-MINOR', matrixName: 'Deviation Minor', description: 'Minor deviation',
    moduleName: 'Deviation', subModule: '', department: 'QA', siteLocation: '', businessUnit: '',
    workflowCode: 'DEV-DEFAULT', documentType: '', category: 'Quality', priority: 'Low',
    productOptional: '', processOptional: '', riskLevel: 'Low', approvalMode: 'Sequential',
    matrixVersion: '1.0', effectiveDate: '', reviewDate: '',
    preparedByRole: 'qa_executive', reviewedByRole: 'department_head', verifiedByRole: '',
    approvedByRole: 'qa_manager', finalApproverRole: 'qa_manager', escalationRole: 'head_qa',
    approvalGroup: '', quorumCount: undefined, minimumApprovalLevel: 2,
    slaHours: 48, reminderHours: 12, autoEscalationEnabled: true, autoEscalationHours: 24,
    autoApproveEnabled: false, allowReject: true, allowReturn: true, allowRework: true,
    allowResubmit: true, allowCancel: false, allowSkip: false,
    eSignatureRequired: true, digitalSignatureRequired: false, approvalCommentRequired: true,
    parallelApprovalAllowed: false, sequentialApprovalRequired: true,
    conditionalApprovalEnabled: false, conditionExpression: '',
    delegationAllowed: false, remarks: 'Minor deviation', changeReason: 'Seed default',
  },
  {
    matrixCode: 'DEV-CRITICAL', matrixName: 'Deviation Critical', description: 'Critical deviation',
    moduleName: 'Deviation', subModule: '', department: 'QA', siteLocation: '', businessUnit: '',
    workflowCode: 'DEV-DEFAULT', documentType: '', category: 'Quality', priority: 'Critical',
    productOptional: '', processOptional: '', riskLevel: 'Critical', approvalMode: 'Sequential',
    matrixVersion: '1.0', effectiveDate: '', reviewDate: '',
    preparedByRole: 'qa_executive', reviewedByRole: 'department_head,qa_manager', verifiedByRole: '',
    approvedByRole: '', finalApproverRole: 'head_qa', escalationRole: 'head_qa',
    approvalGroup: '', quorumCount: undefined, minimumApprovalLevel: 3,
    slaHours: 24, reminderHours: 6, autoEscalationEnabled: true, autoEscalationHours: 12,
    autoApproveEnabled: false, allowReject: true, allowReturn: true, allowRework: true,
    allowResubmit: true, allowCancel: false, allowSkip: false,
    eSignatureRequired: true, digitalSignatureRequired: true, approvalCommentRequired: true,
    parallelApprovalAllowed: false, sequentialApprovalRequired: true,
    conditionalApprovalEnabled: false, conditionExpression: '',
    delegationAllowed: false, remarks: 'Critical deviation', changeReason: 'Seed default',
  },
  {
    matrixCode: 'OOS-DEFAULT', matrixName: 'OOS Approval Matrix', description: 'Default OOS',
    moduleName: 'OOS', subModule: '', department: 'QC', siteLocation: '', businessUnit: '',
    workflowCode: 'OOS-DEFAULT', documentType: '', category: 'Quality', priority: 'High',
    productOptional: '', processOptional: '', riskLevel: 'High', approvalMode: 'Sequential',
    matrixVersion: '1.0', effectiveDate: '', reviewDate: '',
    preparedByRole: 'qc_executive', reviewedByRole: 'qc_manager', verifiedByRole: '',
    approvedByRole: 'qa_manager', finalApproverRole: 'head_qa', escalationRole: 'head_qa',
    approvalGroup: '', quorumCount: undefined, minimumApprovalLevel: 3,
    slaHours: 48, reminderHours: 12, autoEscalationEnabled: true, autoEscalationHours: 24,
    autoApproveEnabled: false, allowReject: true, allowReturn: true, allowRework: true,
    allowResubmit: true, allowCancel: false, allowSkip: false,
    eSignatureRequired: true, digitalSignatureRequired: false, approvalCommentRequired: true,
    parallelApprovalAllowed: false, sequentialApprovalRequired: true,
    conditionalApprovalEnabled: false, conditionExpression: '',
    delegationAllowed: false, remarks: 'Default OOS', changeReason: 'Seed default',
  },
  {
    matrixCode: 'CAPA-DEFAULT', matrixName: 'CAPA Approval Matrix', description: 'Default CAPA',
    moduleName: 'CAPA', subModule: '', department: 'QA', siteLocation: '', businessUnit: '',
    workflowCode: 'CAPA-DEFAULT', documentType: '', category: 'Quality', priority: 'Medium',
    productOptional: '', processOptional: '', riskLevel: 'Medium', approvalMode: 'Sequential',
    matrixVersion: '1.0', effectiveDate: '', reviewDate: '',
    preparedByRole: 'qa_executive', reviewedByRole: 'qa_manager', verifiedByRole: '',
    approvedByRole: 'head_qa', finalApproverRole: 'head_qa', escalationRole: 'head_qa',
    approvalGroup: '', quorumCount: undefined, minimumApprovalLevel: 2,
    slaHours: 72, reminderHours: 24, autoEscalationEnabled: true, autoEscalationHours: 48,
    autoApproveEnabled: false, allowReject: true, allowReturn: true, allowRework: true,
    allowResubmit: true, allowCancel: false, allowSkip: false,
    eSignatureRequired: true, digitalSignatureRequired: false, approvalCommentRequired: true,
    parallelApprovalAllowed: false, sequentialApprovalRequired: true,
    conditionalApprovalEnabled: false, conditionExpression: '',
    delegationAllowed: false, remarks: 'Default CAPA', changeReason: 'Seed default',
  },
  {
    matrixCode: 'CC-CRITICAL', matrixName: 'Change Control Critical', description: 'Critical CC',
    moduleName: 'Change Control', subModule: '', department: 'QA', siteLocation: '', businessUnit: '',
    workflowCode: 'CC-DEFAULT', documentType: '', category: 'Quality', priority: 'Critical',
    productOptional: '', processOptional: '', riskLevel: 'Critical', approvalMode: 'Parallel',
    matrixVersion: '1.0', effectiveDate: '', reviewDate: '',
    preparedByRole: 'qa_executive',
    reviewedByRole: 'qa_manager,qc_manager,production_manager,engineering_manager,regulatory_affairs',
    verifiedByRole: '', approvedByRole: '', finalApproverRole: 'head_qa', escalationRole: 'head_qa',
    approvalGroup: '', quorumCount: undefined, minimumApprovalLevel: 3,
    slaHours: 24, reminderHours: 6, autoEscalationEnabled: true, autoEscalationHours: 12,
    autoApproveEnabled: false, allowReject: true, allowReturn: true, allowRework: true,
    allowResubmit: true, allowCancel: false, allowSkip: false,
    eSignatureRequired: true, digitalSignatureRequired: true, approvalCommentRequired: true,
    parallelApprovalAllowed: true, sequentialApprovalRequired: false,
    conditionalApprovalEnabled: false, conditionExpression: '',
    delegationAllowed: false, remarks: 'Critical change control', changeReason: 'Seed default',
  },
  {
    matrixCode: 'DMS-DEFAULT', matrixName: 'DMS Approval Matrix', description: 'DMS workflow',
    moduleName: 'DMS', subModule: '', department: 'QA', siteLocation: '', businessUnit: '',
    workflowCode: 'DMS-DEFAULT', documentType: 'SOP', category: 'Document', priority: 'Medium',
    productOptional: '', processOptional: '', riskLevel: 'Medium', approvalMode: 'Sequential',
    matrixVersion: '1.0', effectiveDate: '', reviewDate: '',
    preparedByRole: 'qa_executive', reviewedByRole: 'qa_manager', verifiedByRole: '',
    approvedByRole: 'head_qa', finalApproverRole: 'head_qa', escalationRole: 'head_qa',
    approvalGroup: '', quorumCount: undefined, minimumApprovalLevel: 2,
    slaHours: 96, reminderHours: 24, autoEscalationEnabled: true, autoEscalationHours: 48,
    autoApproveEnabled: false, allowReject: true, allowReturn: true, allowRework: true,
    allowResubmit: true, allowCancel: false, allowSkip: false,
    eSignatureRequired: true, digitalSignatureRequired: false, approvalCommentRequired: true,
    parallelApprovalAllowed: false, sequentialApprovalRequired: true,
    conditionalApprovalEnabled: false, conditionExpression: '',
    delegationAllowed: false, remarks: 'DMS workflow', changeReason: 'Seed default',
  },
];

export async function seedDefaultApprovalMatrices(
  meta: ApprovalMatrixAuditMeta,
  reason = 'Seed default approval matrices',
): Promise<{ created: number; skipped: number }> {
  try {
    const seedFn = httpsCallable<
      Record<string, unknown>,
      { created: number; skipped: number }
    >(getFirebaseFunctions(), 'seedAdminDefaultApprovalMatrices');
    const response = await seedFn({
      presets: DEFAULT_APPROVAL_MATRIX_PRESETS,
      reason,
      userId: meta.userId,
    });
    return response.data;
  } catch (error) {
    console.error('seedDefaultApprovalMatrices failed:', error);
    return { created: 0, skipped: DEFAULT_APPROVAL_MATRIX_PRESETS.length };
  }
}

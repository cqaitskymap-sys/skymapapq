import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { ADMIN_COLLECTIONS } from './constants';
import type { AccessReview } from './schemas';

export interface AccessReviewFilters {
  search?: string;
  reviewStatus?: string;
  department?: string;
  role?: string;
  site?: string;
  riskLevel?: string;
  reviewerName?: string;
  period?: string;
  privilegedOnly?: boolean;
  temporaryOnly?: boolean;
  startDate?: string;
  endDate?: string;
}

export type AccessReviewTab =
  | 'all'
  | 'pending'
  | 'in_progress'
  | 'overdue'
  | 'completed'
  | 'rejected'
  | 'privileged'
  | 'sod'
  | 'archived';

const FETCH_LIMIT = 400;

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function normalizeAccessReview(raw: Record<string, unknown>): AccessReview {
  const status = (['Active', 'Inactive', 'Closed'].includes(String(raw.status))
    ? String(raw.status)
    : 'Active') as AccessReview['status'];

  return {
    id: raw.id ? String(raw.id) : undefined,
    status,
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || ''),
    createdBy: String(raw.createdBy || ''),
    updatedBy: String(raw.updatedBy || ''),
    reviewId: String(raw.reviewId || raw.id || ''),
    reviewNumber: String(raw.reviewNumber || ''),
    userId: String(raw.userId || ''),
    employeeId: String(raw.employeeId || ''),
    username: String(raw.username || ''),
    userName: String(raw.userName || raw.employeeName || ''),
    employeeName: String(raw.employeeName || raw.userName || ''),
    email: String(raw.email || ''),
    department: String(raw.department || ''),
    designation: String(raw.designation || ''),
    role: String(raw.role || ''),
    businessUnit: String(raw.businessUnit || ''),
    company: String(raw.company || ''),
    site: String(raw.site || ''),
    manager: String(raw.manager || ''),
    managerId: String(raw.managerId || ''),
    reviewerUserId: String(raw.reviewerUserId || ''),
    reviewerName: String(raw.reviewerName || ''),
    reviewerRole: String(raw.reviewerRole || ''),
    reviewPeriod: String(raw.reviewPeriod || ''),
    reviewStatus: (raw.reviewStatus as AccessReview['reviewStatus']) || 'Pending',
    riskLevel: String(raw.riskLevel || 'Low'),
    accountStatus: String(raw.accountStatus || ''),
    accessStatus: String(raw.accessStatus || ''),
    employmentType: String(raw.employmentType || ''),
    findings: String(raw.findings || ''),
    actionTaken: String(raw.actionTaken || ''),
    reviewComments: String(raw.reviewComments || ''),
    recommendation: String(raw.recommendation || ''),
    finalDecision: String(raw.finalDecision || ''),
    reviewDate: String(raw.reviewDate || ''),
    dueDate: String(raw.dueDate || ''),
    completionDate: (raw.completionDate as string | null) ?? null,
    nextReviewDate: String(raw.nextReviewDate || ''),
    temporaryAccess: Boolean(raw.temporaryAccess),
    privileged: Boolean(raw.privileged),
    criticalIssueCount: Number(raw.criticalIssueCount || 0),
    issues: Array.isArray(raw.issues)
      ? (raw.issues as AccessReview['issues'])
      : [],
    electronicSignature: (raw.electronicSignature as AccessReview['electronicSignature']) ?? null,
    signedAt: (raw.signedAt as string | null) ?? null,
    signedBy: (raw.signedBy as string | null) ?? null,
    signatureMeaning: String(raw.signatureMeaning || ''),
    workflowStage: String(raw.workflowStage || raw.reviewStatus || ''),
    immutable: Boolean(raw.immutable),
    isArchived: Boolean(raw.isArchived),
    changeReason: String(raw.changeReason || ''),
  };
}

function mapDocs(docs: Array<{ id: string; data: () => Record<string, unknown> }>): AccessReview[] {
  return docs.map((d) => normalizeAccessReview({ id: d.id, ...d.data() }));
}

export async function fetchAccessReviews(includeArchived = false): Promise<AccessReview[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const firestore = getFirebaseFirestore();
    const [live, archived] = await Promise.all([
      getDocs(query(
        collection(firestore, ADMIN_COLLECTIONS.accessReviews),
        orderBy('updatedAt', 'desc'),
        limit(FETCH_LIMIT),
      )),
      includeArchived
        ? getDocs(query(
          collection(firestore, ADMIN_COLLECTIONS.accessReviewsArchive),
          orderBy('archivedAt', 'desc'),
          limit(200),
        )).catch(() => ({ docs: [] as Array<{ id: string; data: () => Record<string, unknown> }> }))
        : Promise.resolve({ docs: [] as Array<{ id: string; data: () => Record<string, unknown> }> }),
    ]);
    return [
      ...mapDocs(live.docs),
      ...mapDocs(archived.docs).map((r) => ({ ...r, isArchived: true })),
    ].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  } catch (error) {
    console.error('fetchAccessReviews failed:', error);
    throw new Error('Unable to load access reviews. Check connection and permissions.');
  }
}

export function subscribeToAccessReviews(
  onData: (rows: AccessReview[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const q = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.accessReviews),
    orderBy('updatedAt', 'desc'),
    limit(FETCH_LIMIT),
  );
  return onSnapshot(
    q,
    (snapshot) => onData(mapDocs(snapshot.docs)),
    (error) => {
      console.error('subscribeToAccessReviews failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to access reviews'));
    },
  );
}

export async function fetchAccessReviewById(id: string): Promise<AccessReview | null> {
  if (!isFirebaseConfigured() || !id) return null;
  const firestore = getFirebaseFirestore();
  for (const name of [ADMIN_COLLECTIONS.accessReviews, ADMIN_COLLECTIONS.accessReviewsArchive]) {
    try {
      const snap = await getDoc(doc(firestore, name, id));
      if (snap.exists()) {
        return normalizeAccessReview({
          id: snap.id,
          ...snap.data(),
          isArchived: name === ADMIN_COLLECTIONS.accessReviewsArchive,
        });
      }
    } catch {
      // continue
    }
  }
  return null;
}

export function applyAccessReviewFilters(
  rows: AccessReview[],
  filters: AccessReviewFilters,
): AccessReview[] {
  const q = filters.search?.toLowerCase() || '';
  return rows.filter((r) => {
    const matchSearch = !q
      || r.reviewId.toLowerCase().includes(q)
      || r.reviewNumber.toLowerCase().includes(q)
      || r.userName.toLowerCase().includes(q)
      || r.employeeId.toLowerCase().includes(q)
      || r.email.toLowerCase().includes(q)
      || r.role.toLowerCase().includes(q)
      || r.reviewerName.toLowerCase().includes(q);
    const matchStatus = !filters.reviewStatus || filters.reviewStatus === 'all'
      || r.reviewStatus === filters.reviewStatus;
    const matchDept = !filters.department || filters.department === 'all'
      || r.department === filters.department;
    const matchRole = !filters.role || filters.role === 'all' || r.role === filters.role;
    const matchSite = !filters.site || filters.site === 'all' || r.site === filters.site;
    const matchRisk = !filters.riskLevel || filters.riskLevel === 'all'
      || r.riskLevel === filters.riskLevel;
    const matchReviewer = !filters.reviewerName
      || r.reviewerName.toLowerCase().includes(filters.reviewerName.toLowerCase());
    const matchPeriod = !filters.period || r.reviewPeriod === filters.period;
    const matchPriv = !filters.privilegedOnly || r.privileged;
    const matchTemp = !filters.temporaryOnly || r.temporaryAccess;
    const matchStart = !filters.startDate || (r.reviewDate || '') >= filters.startDate;
    const matchEnd = !filters.endDate || (r.reviewDate || '') <= filters.endDate;
    return matchSearch && matchStatus && matchDept && matchRole && matchSite
      && matchRisk && matchReviewer && matchPeriod && matchPriv && matchTemp
      && matchStart && matchEnd;
  });
}

export function applyAccessReviewTab(rows: AccessReview[], tab: AccessReviewTab): AccessReview[] {
  switch (tab) {
    case 'pending':
      return rows.filter((r) => ['Draft', 'Pending'].includes(r.reviewStatus));
    case 'in_progress':
      return rows.filter((r) => [
        'In Progress', 'Self Review', 'Manager Review', 'QA Review', 'IT Review',
        'Pending Approval', 'Changes Requested',
      ].includes(r.reviewStatus));
    case 'overdue':
      return rows.filter((r) => r.reviewStatus === 'Overdue');
    case 'completed':
      return rows.filter((r) => ['Completed', 'Closed'].includes(r.reviewStatus));
    case 'rejected':
      return rows.filter((r) => r.reviewStatus === 'Rejected');
    case 'privileged':
      return rows.filter((r) => r.privileged);
    case 'sod':
      return rows.filter((r) => (r.criticalIssueCount || 0) > 0
        || (r.issues || []).some((i) => String(i.code).startsWith('SOD')));
    case 'archived':
      return rows.filter((r) => r.isArchived || r.reviewStatus === 'Archived');
    default:
      return rows.filter((r) => !r.isArchived && r.reviewStatus !== 'Archived');
  }
}

export function getAccessReviewSummary(rows: AccessReview[]) {
  const live = rows.filter((r) => !r.isArchived && r.reviewStatus !== 'Archived');
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: live.length,
    pending: live.filter((r) => ['Draft', 'Pending'].includes(r.reviewStatus)).length,
    inProgress: live.filter((r) => [
      'In Progress', 'Self Review', 'Manager Review', 'QA Review', 'IT Review', 'Pending Approval',
    ].includes(r.reviewStatus)).length,
    overdue: live.filter((r) => r.reviewStatus === 'Overdue'
      || (r.dueDate && r.dueDate < today && !['Completed', 'Closed', 'Archived'].includes(r.reviewStatus))).length,
    completed: live.filter((r) => r.reviewStatus === 'Completed').length,
    rejected: live.filter((r) => r.reviewStatus === 'Rejected').length,
    privileged: live.filter((r) => r.privileged).length,
    critical: live.filter((r) => r.riskLevel === 'Critical' || (r.criticalIssueCount || 0) > 0).length,
  };
}

export function exportAccessReviewCsv(rows: AccessReview[]): string {
  const headers = [
    'Review ID', 'Review Number', 'Employee', 'Employee ID', 'Role', 'Department', 'Site',
    'Reviewer', 'Period', 'Status', 'Risk', 'Decision', 'Due Date', 'Completion Date',
  ];
  const lines = rows.map((r) => [
    r.reviewId, r.reviewNumber, r.userName, r.employeeId, r.role, r.department, r.site,
    r.reviewerName, r.reviewPeriod, r.reviewStatus, r.riskLevel, r.finalDecision,
    r.dueDate, r.completionDate || '',
  ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  return `\uFEFF${headers.join(',')}\n${lines.join('\n')}`;
}

export function openAccessReviewPdfReport(
  rows: AccessReview[],
  title: string,
  generatedBy: string,
): void {
  const win = window.open('', '_blank');
  if (!win) return;
  const body = rows.slice(0, 200).map((r) => `
    <tr>
      <td>${r.reviewId}</td><td>${r.userName}</td><td>${r.role}</td>
      <td>${r.reviewStatus}</td><td>${r.riskLevel}</td><td>${r.finalDecision || '-'}</td>
    </tr>`).join('');
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
    <style>body{font-family:Segoe UI,sans-serif;padding:24px}table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#f1f5f9}</style></head>
    <body><h1>${title}</h1><p>Generated by ${generatedBy} · ${new Date().toLocaleString()} · ${rows.length} records</p>
    <table><thead><tr><th>Review ID</th><th>User</th><th>Role</th><th>Status</th><th>Risk</th><th>Decision</th></tr></thead>
    <tbody>${body}</tbody></table></body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

export async function createAccessReview(payload: Record<string, unknown>) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'createAdminAccessReview');
    const result = await fn(payload);
    return { data: result.data as { id: string; reviewId: string }, error: null as string | null };
  } catch (error) {
    return { data: null, error: callableErrorMessage(error, 'Unable to create access review') };
  }
}

export async function updateAccessReview(payload: Record<string, unknown>) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'updateAdminAccessReview');
    await fn(payload);
    return { error: null as string | null };
  } catch (error) {
    return { error: callableErrorMessage(error, 'Unable to update access review') };
  }
}

export async function transitionAccessReview(
  id: string,
  targetStatus: string,
  changeReason: string,
  reviewComments?: string,
) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'transitionAdminAccessReview');
    await fn({ id, targetStatus, changeReason, reviewComments });
    return { error: null as string | null };
  } catch (error) {
    return { error: callableErrorMessage(error, 'Unable to transition access review') };
  }
}

export async function completeAccessReview(payload: Record<string, unknown>) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'completeAdminAccessReview');
    await fn(payload);
    return { error: null as string | null };
  } catch (error) {
    return { error: callableErrorMessage(error, 'Unable to complete access review') };
  }
}

export async function generateAccessReviewCampaign(payload: Record<string, unknown>) {
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { created: number; skipped: number; reviewPeriod: string }
    >(getFirebaseFunctions(), 'generateAdminAccessReviewCampaign');
    const result = await fn(payload);
    return { data: result.data, error: null as string | null };
  } catch (error) {
    return { data: null, error: callableErrorMessage(error, 'Unable to generate campaign') };
  }
}

export async function analyzeAccessRisks() {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'analyzeAdminAccessRisks');
    const result = await fn({});
    return { data: result.data as Record<string, unknown>, error: null as string | null };
  } catch (error) {
    return { data: null, error: callableErrorMessage(error, 'Unable to analyze access risks') };
  }
}

export async function archiveAccessReviews(beforeDate: string, changeReason: string) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'archiveAdminAccessReviews');
    const result = await fn({ beforeDate, changeReason });
    return { data: result.data as { archived: number }, error: null as string | null };
  } catch (error) {
    return { data: null, error: callableErrorMessage(error, 'Unable to archive reviews') };
  }
}

export async function markAccessReviewsOverdue() {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'markAdminAccessReviewsOverdue');
    const result = await fn({});
    return { data: result.data as { marked: number }, error: null as string | null };
  } catch (error) {
    return { data: null, error: callableErrorMessage(error, 'Unable to mark overdue reviews') };
  }
}

export async function logAccessReviewExport(format: string, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminAccessReviewExport');
    await fn({ format, count });
  } catch (error) {
    console.error('ACCESS_REVIEW_FAILURE: logAccessReviewExport', error);
  }
}

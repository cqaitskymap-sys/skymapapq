import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { createAuditLog, shouldSkipRemoteAuditInLocalDev } from '@/lib/audit-trail';
import { getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import {
  ADMIN_COLLECTIONS, ADMIN_AUDIT_MODULES, QMS_AUDIT_MODULES, CRITICAL_AUDIT_ACTIONS,
} from './constants';
import type { AuditTrailEntry } from './schemas';
import {
  canViewAllAuditTrail, canViewAdminAuditTrail, canViewQmsAuditTrail,
} from '@/lib/permissions';

export interface AuditTrailFilters {
  search?: string;
  moduleName?: string;
  actionType?: string;
  userId?: string;
  department?: string;
  site?: string;
  status?: string;
  recordId?: string;
  documentNumber?: string;
  startDate?: string;
  endDate?: string;
  eSignature?: string;
  ipAddress?: string;
}

export interface AuditTrailAuditMeta {
  userId: string;
  userName: string;
  role?: string;
  department?: string;
}

export type AuditListTab =
  | 'all'
  | 'login'
  | 'logout'
  | 'failed-login'
  | 'approvals'
  | 'esign'
  | 'config'
  | 'exports'
  | 'archived';

const FETCH_LIMIT = 500;

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function normalizeAuditTrailEntry(raw: Record<string, unknown>): AuditTrailEntry {
  const dateTime = String(raw.dateTime || raw.timestamp || raw.loginTime || '');
  const actionType = String(raw.actionType || raw.action || '');
  const recordId = String(raw.recordId || raw.documentId || raw.referenceId || '');
  const userName = String(raw.changedByUserName || raw.userName || raw.fullName || '');
  return {
    id: raw.id as string | undefined,
    auditId: String(raw.auditId || raw.id || ''),
    transactionId: String(raw.transactionId || ''),
    referenceId: String(raw.referenceId || recordId),
    dateTime,
    timestamp: dateTime,
    timezone: String(raw.timezone || 'UTC'),
    moduleName: String(raw.moduleName || raw.module || ''),
    subModule: String(raw.subModule || ''),
    screen: String(raw.screen || ''),
    collectionName: String(raw.collectionName || ''),
    recordId,
    documentId: recordId,
    documentNumber: String(raw.documentNumber || ''),
    actionType,
    action: actionType,
    actionDescription: String(raw.actionDescription || ''),
    fieldName: String(raw.fieldName || ''),
    oldValue: stringifyValue(raw.oldValue),
    newValue: stringifyValue(raw.newValue),
    changedFields: String(raw.changedFields || ''),
    changedByUserId: String(raw.changedByUserId || raw.userId || ''),
    changedByUserName: userName,
    changedByRole: String(raw.changedByRole || raw.role || ''),
    userId: String(raw.userId || raw.changedByUserId || ''),
    userName,
    employeeId: String(raw.employeeId || ''),
    username: String(raw.username || userName),
    fullName: String(raw.fullName || userName),
    role: String(raw.role || raw.changedByRole || ''),
    department: String(raw.department || ''),
    site: String(raw.site || ''),
    businessUnit: String(raw.businessUnit || ''),
    company: String(raw.company || ''),
    reasonForChange: String(raw.reasonForChange || raw.reason || raw.failureReason || ''),
    reason: String(raw.reason || raw.reasonForChange || ''),
    remarks: String(raw.remarks || ''),
    ipAddress: String(raw.ipAddress || ''),
    deviceInfo: String(raw.deviceInfo || raw.device || ''),
    device: String(raw.device || raw.deviceInfo || ''),
    browserInfo: String(raw.browserInfo || ''),
    operatingSystem: String(raw.operatingSystem || ''),
    sessionId: String(raw.sessionId || ''),
    requestId: String(raw.requestId || ''),
    workflowId: String(raw.workflowId || ''),
    approvalLevel: String(raw.approvalLevel || ''),
    location: String(raw.location || ''),
    eSignatureRequired: Boolean(raw.eSignatureRequired),
    eSignatureStatus: String(raw.eSignatureStatus || ''),
    eSignatureId: String(raw.eSignatureId || ''),
    previousHash: String(raw.previousHash || ''),
    integrityHash: String(raw.integrityHash || ''),
    status: (raw.status as AuditTrailEntry['status']) || 'Success',
    isArchived: Boolean(raw.isArchived || raw.copiedToArchive),
    copiedToArchive: Boolean(raw.copiedToArchive),
  };
}

function loginActivityToAudit(raw: Record<string, unknown>): AuditTrailEntry {
  const status = String(raw.loginStatus || 'Success');
  const hasLogout = Boolean(raw.logoutTime);
  const actionType = status === 'Failed' ? 'Failed Login' : hasLogout ? 'Logout' : 'Login';
  return normalizeAuditTrailEntry({
    ...raw,
    moduleName: 'Admin',
    subModule: 'Login Activity',
    actionType,
    actionDescription: status === 'Failed'
      ? `Failed login: ${raw.failureReason || 'Unknown'}`
      : hasLogout ? 'User logout' : 'User login',
    recordId: String(raw.userId || raw.id || ''),
    status: status === 'Failed' ? 'Failed' : 'Success',
    dateTime: hasLogout ? raw.logoutTime : raw.loginTime,
    userId: raw.userId,
    userName: raw.userName,
    department: '',
    reason: raw.failureReason,
  });
}

function isCriticalAction(actionType: string): boolean {
  const norm = actionType.toLowerCase().replace(/_/g, ' ').trim();
  return CRITICAL_AUDIT_ACTIONS.some((c) => c.toLowerCase() === norm);
}

function normalizeActionMatch(actionType: string, target: string): boolean {
  return actionType.toLowerCase().replace(/_/g, ' ') === target.toLowerCase();
}

export function filterAuditTrailByRole(
  entries: AuditTrailEntry[],
  role?: string | null,
  currentUserId?: string,
): AuditTrailEntry[] {
  if (canViewAllAuditTrail(role)) return entries;

  if (canViewAdminAuditTrail(role)) {
    const adminSet = new Set<string>(ADMIN_AUDIT_MODULES as unknown as string[]);
    return entries.filter((e) => adminSet.has(e.moduleName) || e.changedByUserId === currentUserId);
  }

  if (canViewQmsAuditTrail(role)) {
    const qmsSet = new Set<string>(QMS_AUDIT_MODULES as unknown as string[]);
    return entries.filter((e) => qmsSet.has(e.moduleName) || e.changedByUserId === currentUserId);
  }

  if (currentUserId) {
    return entries.filter((e) => e.changedByUserId === currentUserId || e.userId === currentUserId);
  }

  return [];
}

function mapDocs(docs: Array<{ id: string; data: () => Record<string, unknown> }>): AuditTrailEntry[] {
  return docs.map((d) => normalizeAuditTrailEntry({ id: d.id, ...d.data() }));
}

async function fetchCollectionOrdered(
  collectionName: string,
  orderField: string,
  max = FETCH_LIMIT,
): Promise<AuditTrailEntry[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), collectionName),
      orderBy(orderField, 'desc'),
      limit(max),
    ));
    return mapDocs(snap.docs);
  } catch (error) {
    console.error(`fetch ${collectionName} failed:`, error);
    return [];
  }
}

export async function fetchAuditTrailEntries(includeArchived = false): Promise<AuditTrailEntry[]> {
  try {
    const firestore = getFirebaseFirestore();
    const [trail, adminLogs, loginSnap, archived] = await Promise.all([
      fetchCollectionOrdered(ADMIN_COLLECTIONS.auditTrail, 'dateTime'),
      fetchCollectionOrdered(ADMIN_COLLECTIONS.auditLogs, 'dateTime'),
      getDocs(query(
        collection(firestore, ADMIN_COLLECTIONS.loginActivity),
        orderBy('loginTime', 'desc'),
        limit(200),
      )).catch(() => ({ docs: [] as Array<{ id: string; data: () => Record<string, unknown> }> })),
      includeArchived
        ? fetchCollectionOrdered(ADMIN_COLLECTIONS.auditTrailArchive, 'dateTime', 200)
        : Promise.resolve([]),
    ]);

    const fromLogin = loginSnap.docs.map((d) => loginActivityToAudit({ id: d.id, ...d.data() }));
    const merged = [
      ...trail,
      ...adminLogs,
      ...fromLogin,
      ...archived.map((a) => ({ ...a, isArchived: true })),
    ];

    const seen = new Set<string>();
    const deduped: AuditTrailEntry[] = [];
    for (const entry of merged.sort((a, b) => b.dateTime.localeCompare(a.dateTime))) {
      const key = entry.id || `${entry.auditId}-${entry.dateTime}-${entry.actionType}-${entry.recordId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(entry);
    }
    return deduped;
  } catch (error) {
    console.error('fetchAuditTrailEntries failed:', error);
    throw new Error('Unable to load audit trail. Check connection and permissions.');
  }
}

export function subscribeToAuditTrail(
  onData: (entries: AuditTrailEntry[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const firestore = getFirebaseFirestore();
  const trailQuery = query(
    collection(firestore, ADMIN_COLLECTIONS.auditTrail),
    orderBy('dateTime', 'desc'),
    limit(FETCH_LIMIT),
  );
  return onSnapshot(
    trailQuery,
    async (snapshot) => {
      try {
        const trail = mapDocs(snapshot.docs);
        const [adminLogs, loginSnap] = await Promise.all([
          fetchCollectionOrdered(ADMIN_COLLECTIONS.auditLogs, 'dateTime', 200),
          getDocs(query(
            collection(firestore, ADMIN_COLLECTIONS.loginActivity),
            orderBy('loginTime', 'desc'),
            limit(100),
          )).catch(() => ({ docs: [] as Array<{ id: string; data: () => Record<string, unknown> }> })),
        ]);
        const fromLogin = loginSnap.docs.map((d) => loginActivityToAudit({ id: d.id, ...d.data() }));
        const merged = [...trail, ...adminLogs, ...fromLogin]
          .sort((a, b) => b.dateTime.localeCompare(a.dateTime));
        const seen = new Set<string>();
        const deduped = merged.filter((e) => {
          const key = e.id || `${e.auditId}-${e.dateTime}-${e.actionType}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        onData(deduped);
      } catch (error) {
        onError?.(error as Error);
      }
    },
    (error) => {
      console.error('subscribeToAuditTrail failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to audit trail'));
    },
  );
}

export async function fetchAuditTrailById(id: string): Promise<AuditTrailEntry | null> {
  if (!isFirebaseConfigured() || !id) return null;
  const firestore = getFirebaseFirestore();
  const collections = [
    ADMIN_COLLECTIONS.auditTrail,
    ADMIN_COLLECTIONS.auditLogs,
    ADMIN_COLLECTIONS.auditTrailArchive,
    ADMIN_COLLECTIONS.loginActivity,
  ];
  for (const name of collections) {
    try {
      const snap = await getDoc(doc(firestore, name, id));
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() };
        if (name === ADMIN_COLLECTIONS.loginActivity) return loginActivityToAudit(data);
        return normalizeAuditTrailEntry(data);
      }
    } catch {
      // try next
    }
  }
  // Fallback: search recent by auditId field
  try {
    const snap = await getDocs(query(
      collection(firestore, ADMIN_COLLECTIONS.auditTrail),
      where('auditId', '==', id),
      limit(1),
    ));
    if (!snap.empty) {
      return normalizeAuditTrailEntry({ id: snap.docs[0].id, ...snap.docs[0].data() });
    }
  } catch {
    // ignore
  }
  return null;
}

export function applyAuditTrailFilters(entries: AuditTrailEntry[], filters: AuditTrailFilters): AuditTrailEntry[] {
  const q = filters.search?.toLowerCase() || '';
  return entries.filter((e) => {
    const matchSearch = !q ||
      e.changedByUserName.toLowerCase().includes(q) ||
      e.moduleName.toLowerCase().includes(q) ||
      e.subModule.toLowerCase().includes(q) ||
      e.recordId.toLowerCase().includes(q) ||
      e.documentNumber.toLowerCase().includes(q) ||
      e.actionType.toLowerCase().includes(q) ||
      e.actionDescription.toLowerCase().includes(q) ||
      e.auditId.toLowerCase().includes(q) ||
      e.ipAddress.toLowerCase().includes(q);
    const matchModule = !filters.moduleName || filters.moduleName === 'all' || e.moduleName === filters.moduleName;
    const matchAction = !filters.actionType || filters.actionType === 'all' || e.actionType === filters.actionType;
    const matchUser = !filters.userId || filters.userId === 'all' || e.changedByUserId === filters.userId;
    const matchDept = !filters.department || filters.department === 'all' || e.department === filters.department;
    const matchSite = !filters.site || filters.site === 'all' || e.site === filters.site;
    const matchStatus = !filters.status || filters.status === 'all' || e.status === filters.status;
    const matchRecord = !filters.recordId || e.recordId.includes(filters.recordId);
    const matchDoc = !filters.documentNumber || e.documentNumber.includes(filters.documentNumber);
    const matchIp = !filters.ipAddress || e.ipAddress.includes(filters.ipAddress);
    const matchEsign = !filters.eSignature || filters.eSignature === 'all'
      || (filters.eSignature === 'yes' && e.eSignatureRequired)
      || (filters.eSignature === 'no' && !e.eSignatureRequired);
    const matchStart = !filters.startDate || e.dateTime >= filters.startDate;
    const matchEnd = !filters.endDate || e.dateTime <= `${filters.endDate}T23:59:59`;
    return matchSearch && matchModule && matchAction && matchUser && matchDept && matchSite
      && matchStatus && matchRecord && matchDoc && matchIp && matchEsign && matchStart && matchEnd;
  });
}

export function applyAuditListTab(entries: AuditTrailEntry[], tab: AuditListTab): AuditTrailEntry[] {
  switch (tab) {
    case 'login':
      return entries.filter((e) => normalizeActionMatch(e.actionType, 'Login'));
    case 'logout':
      return entries.filter((e) => normalizeActionMatch(e.actionType, 'Logout'));
    case 'failed-login':
      return entries.filter((e) => normalizeActionMatch(e.actionType, 'Failed Login') || e.status === 'Failed');
    case 'approvals':
      return entries.filter((e) =>
        ['Approve', 'Reject', 'Return', 'Rework', 'Resubmit'].some((a) => normalizeActionMatch(e.actionType, a)));
    case 'esign':
      return entries.filter((e) => normalizeActionMatch(e.actionType, 'E-Signature') || e.eSignatureRequired);
    case 'config':
      return entries.filter((e) =>
        ['System Setting Change', 'Configuration Change', 'Permission Change', 'Role Change', 'Workflow Change']
          .some((a) => normalizeActionMatch(e.actionType, a)));
    case 'exports':
      return entries.filter((e) =>
        ['Export', 'Import', 'Print', 'Download'].some((a) => normalizeActionMatch(e.actionType, a)));
    case 'archived':
      return entries.filter((e) => e.isArchived || e.copiedToArchive);
    default:
      return entries.filter((e) => !e.isArchived);
  }
}

export function getAuditTrailSummary(entries: AuditTrailEntry[]) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: entries.length,
    todayActivities: entries.filter((e) => e.dateTime.startsWith(today)).length,
    criticalActions: entries.filter((e) => isCriticalAction(e.actionType)).length,
    failedLogins: entries.filter((e) => normalizeActionMatch(e.actionType, 'Failed Login') || e.status === 'Failed').length,
    approvalActions: entries.filter((e) => normalizeActionMatch(e.actionType, 'Approve')).length,
    rejectedActions: entries.filter((e) => normalizeActionMatch(e.actionType, 'Reject')).length,
    exportActions: entries.filter((e) => normalizeActionMatch(e.actionType, 'Export')).length,
    systemSettingChanges: entries.filter((e) =>
      normalizeActionMatch(e.actionType, 'System Setting Change')
      || normalizeActionMatch(e.actionType, 'Configuration Change')).length,
    eSignatureActions: entries.filter((e) => normalizeActionMatch(e.actionType, 'E-Signature') || e.eSignatureRequired).length,
    withIntegrityHash: entries.filter((e) => Boolean(e.integrityHash)).length,
  };
}

export function getAuditChartsData(entries: AuditTrailEntry[]) {
  const byModule = new Map<string, number>();
  const byAction = new Map<string, number>();
  const userActivity = new Map<string, number>();
  const failedByDay = new Map<string, number>();
  const criticalByDay = new Map<string, number>();

  for (const e of entries) {
    byModule.set(e.moduleName, (byModule.get(e.moduleName) || 0) + 1);
    byAction.set(e.actionType, (byAction.get(e.actionType) || 0) + 1);
    const userKey = e.changedByUserName || 'Unknown';
    userActivity.set(userKey, (userActivity.get(userKey) || 0) + 1);
    const day = e.dateTime.slice(0, 10);
    if (normalizeActionMatch(e.actionType, 'Failed Login') || e.status === 'Failed') {
      failedByDay.set(day, (failedByDay.get(day) || 0) + 1);
    }
    if (isCriticalAction(e.actionType)) {
      criticalByDay.set(day, (criticalByDay.get(day) || 0) + 1);
    }
  }

  const toChart = (map: Map<string, number>, limitN = 8) =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limitN)
      .map(([name, value]) => ({ name, value }));

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });

  return {
    byModule: toChart(byModule),
    byAction: toChart(byAction, 10),
    userActivity: toChart(userActivity, 10),
    failedLoginTrend: last7Days.map((day) => ({
      name: day,
      value: failedByDay.get(day) || 0,
    })),
    criticalTrend: last7Days.map((day) => ({
      name: day,
      value: criticalByDay.get(day) || 0,
    })),
  };
}

export function getRecordTimeline(entries: AuditTrailEntry[], recordId: string): AuditTrailEntry[] {
  return entries
    .filter((e) => e.recordId === recordId || e.documentNumber === recordId || e.referenceId === recordId)
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
}

export function getUserActivityTimeline(entries: AuditTrailEntry[], userId: string): AuditTrailEntry[] {
  return entries
    .filter((e) => e.changedByUserId === userId || e.userId === userId)
    .sort((a, b) => b.dateTime.localeCompare(a.dateTime));
}

export function exportAuditTrailExcel(entries: AuditTrailEntry[]): string {
  const BOM = '\uFEFF';
  const headers = [
    'Audit ID', 'Transaction ID', 'Date Time', 'Timezone', 'Module', 'Sub Module', 'Screen',
    'Collection', 'Record ID', 'Document Number', 'Action Type', 'Description', 'Field',
    'Old Value', 'New Value', 'Changed Fields', 'User ID', 'Employee ID', 'Username', 'Full Name',
    'Role', 'Department', 'Site', 'Business Unit', 'Company', 'Reason', 'Remarks',
    'IP', 'Device', 'Browser', 'OS', 'Session ID', 'Workflow ID', 'Approval Level',
    'E-Sign Required', 'E-Sign Status', 'Integrity Hash', 'Previous Hash', 'Status',
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = entries.map((e) => [
    e.auditId, e.transactionId, e.dateTime, e.timezone, e.moduleName, e.subModule, e.screen,
    e.collectionName, e.recordId, e.documentNumber, e.actionType, e.actionDescription, e.fieldName,
    stringifyValue(e.oldValue), stringifyValue(e.newValue), e.changedFields,
    e.changedByUserId, e.employeeId, e.username, e.fullName || e.changedByUserName,
    e.changedByRole || e.role, e.department, e.site, e.businessUnit, e.company,
    e.reasonForChange, e.remarks, e.ipAddress, e.deviceInfo, e.browserInfo, e.operatingSystem,
    e.sessionId, e.workflowId, e.approvalLevel,
    e.eSignatureRequired ? 'Yes' : 'No', e.eSignatureStatus, e.integrityHash, e.previousHash, e.status,
  ].map((c) => escape(String(c ?? ''))).join(','));

  return BOM + [headers.join(','), ...rows].join('\n');
}

export function buildAuditTrailPdfHtml(
  entries: AuditTrailEntry[],
  filters: AuditTrailFilters,
  generatedBy: string,
  reportTitle = 'Audit Trail Report',
): string {
  const filterLines = [
    filters.moduleName && filters.moduleName !== 'all' ? `Module: ${filters.moduleName}` : null,
    filters.actionType && filters.actionType !== 'all' ? `Action: ${filters.actionType}` : null,
    filters.startDate ? `From: ${filters.startDate}` : null,
    filters.endDate ? `To: ${filters.endDate}` : null,
    filters.userId && filters.userId !== 'all' ? `User ID: ${filters.userId}` : null,
  ].filter(Boolean).join(' | ');

  const rows = entries.slice(0, 500).map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${e.dateTime ? new Date(e.dateTime).toLocaleString() : '—'}</td>
      <td>${e.moduleName}</td>
      <td>${e.recordId}</td>
      <td>${e.actionType}</td>
      <td>${e.changedByUserName}</td>
      <td>${e.status}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${reportTitle}</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; margin: 24px; color: #1e293b; }
    h1 { color: #0f4c5c; margin-bottom: 4px; font-size: 22px; }
    .meta { font-size: 12px; color: #64748b; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; font-family: system-ui, sans-serif; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #ecfdf5; }
    .footer { margin-top: 24px; font-size: 11px; color: #64748b; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <h1>SkyMap QMS — ${reportTitle}</h1>
  <p class="meta">FDA 21 CFR Part 11 / EU GMP Annex 11 / ALCOA+ | Generated: ${new Date().toLocaleString()}</p>
  <p class="meta">Generated by: ${generatedBy}</p>
  ${filterLines ? `<p class="meta">Filters: ${filterLines}</p>` : ''}
  <p class="meta">Total records: ${entries.length}${entries.length > 500 ? ' (showing first 500)' : ''}</p>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Date Time</th><th>Module</th><th>Record ID</th>
        <th>Action</th><th>User</th><th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    <p>System-generated read-only report. Audit records are append-only with integrity hashing.</p>
    <p>UTC: ${new Date().toISOString()}</p>
  </div>
  <button class="no-print" onclick="window.print()">Print / Save as PDF</button>
</body>
</html>`;
}

export function openAuditTrailPdfReport(
  entries: AuditTrailEntry[],
  filters: AuditTrailFilters,
  generatedBy: string,
  reportTitle?: string,
): void {
  const html = buildAuditTrailPdfHtml(entries, filters, generatedBy, reportTitle);
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

export async function logAuditTrailExport(
  meta: AuditTrailAuditMeta,
  format: 'Excel' | 'PDF' | 'Print',
  count: number,
): Promise<void> {
  if (!shouldSkipRemoteAuditInLocalDev()) {
    try {
      const fn = httpsCallable(getFirebaseFunctions(), 'logAdminAuditTrailExport');
      await fn({ format, count, reason: `Audit trail exported as ${format} (${count} records)` });
      return;
    } catch (error) {
      console.error('logAuditTrailExport callable failed, falling back:', error);
    }
  }
  await createAuditLog({
    moduleName: 'Admin',
    collectionName: ADMIN_COLLECTIONS.auditTrail,
    recordId: 'export',
    actionType: 'Export',
    actionDescription: `Audit trail exported as ${format} (${count} records)`,
    user: { id: meta.userId, name: meta.userName, role: meta.role, department: meta.department },
    status: 'Success',
  });
}

export async function archiveAuditTrail(
  beforeDate: string,
  reason: string,
): Promise<{ archived: number; error?: string }> {
  if (shouldSkipRemoteAuditInLocalDev()) {
    return {
      archived: 0,
      error: 'Archive requires deployed Cloud Functions (enable billing and deploy, or use emulators).',
    };
  }
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { archived: number }
    >(getFirebaseFunctions(), 'archiveAdminAuditTrail');
    const response = await fn({ beforeDate, reason });
    return { archived: response.data.archived };
  } catch (error) {
    return { archived: 0, error: callableErrorMessage(error, 'Archive failed') };
  }
}

export async function verifyAuditIntegrity(limitN = 50): Promise<{
  checked: number;
  verified: number;
  mismatches: number;
  issues: string[];
  error?: string;
}> {
  if (shouldSkipRemoteAuditInLocalDev()) {
    return {
      checked: 0,
      verified: 0,
      mismatches: 0,
      issues: [],
      error: 'Integrity verification requires deployed Cloud Functions.',
    };
  }
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { checked: number; verified: number; mismatches: number; issues: string[] }
    >(getFirebaseFunctions(), 'verifyAdminAuditIntegrity');
    const response = await fn({ limit: limitN });
    return response.data;
  } catch (error) {
    return {
      checked: 0, verified: 0, mismatches: 0, issues: [],
      error: callableErrorMessage(error, 'Integrity verification failed'),
    };
  }
}

export async function getAuditIntegrityStatus(): Promise<{
  lastIntegrityHash: string | null;
  lastAuditId: string | null;
  updatedAt: string | null;
  chainInitialized: boolean;
}> {
  if (shouldSkipRemoteAuditInLocalDev()) {
    return {
      lastIntegrityHash: null, lastAuditId: null, updatedAt: null, chainInitialized: false,
    };
  }
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      {
        lastIntegrityHash: string | null;
        lastAuditId: string | null;
        updatedAt: string | null;
        chainInitialized: boolean;
      }
    >(getFirebaseFunctions(), 'getAdminAuditIntegrityStatus');
    const response = await fn({});
    return response.data;
  } catch {
    return {
      lastIntegrityHash: null, lastAuditId: null, updatedAt: null, chainInitialized: false,
    };
  }
}

export function buildPeriodReportEntries(
  entries: AuditTrailEntry[],
  period: 'daily' | 'weekly' | 'monthly',
): AuditTrailEntry[] {
  const now = new Date();
  let start: Date;
  if (period === 'daily') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === 'weekly') {
    start = new Date(now);
    start.setDate(now.getDate() - 7);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const startIso = start.toISOString();
  return entries.filter((e) => e.dateTime >= startIso);
}

import {
  collection, getCountFromServer, getDocs, limit, orderBy, query, where,
  type QueryConstraint,
} from 'firebase/firestore';
import {
  getFirebaseFirestore, isFirebaseConfigured, getFirebaseAuth,
} from '@/lib/firebase';
import { getFirebaseStorageHealthStatus } from '@/lib/firebase-config';
import { ADMIN_COLLECTIONS, ADMIN_ROLES } from './constants';
import {
  checkFirebaseConnection, getAuditLogs, logAuditEvent,
} from './admin-service';
import type { AdminUser } from './schemas';

export interface DashboardKpis {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  lockedUsers: number;
  totalRoles: number;
  totalDepartments: number;
  totalSites: number;
  pendingApprovals: number;
  totalAuditRecords: number;
  firebaseStatus: string;
  lastBackupStatus: string;
  systemHealthScore: number;
}

export interface LoginActivityRow {
  id?: string;
  userName: string;
  email: string;
  role: string;
  loginTime: string;
  deviceIp: string;
  status: string;
}

export interface AdminActionRow {
  id?: string;
  module: string;
  action: string;
  userName: string;
  dateTime: string;
  status: string;
}

export interface PendingApprovalRow {
  id: string;
  type: string;
  title: string;
  requestedBy: string;
  date: string;
  status: string;
}

export interface SystemHealthDetail {
  name: string;
  status: 'Healthy' | 'Degraded' | 'Down';
  detail: string;
}

export interface ChartPoint {
  name: string;
  value: number;
}

export interface AdminDashboardData {
  kpis: DashboardKpis;
  moduleKpis: Array<{ label: string; value: number; href: string }>;
  loginActivity: LoginActivityRow[];
  recentActions: AdminActionRow[];
  pendingApprovals: PendingApprovalRow[];
  systemHealth: {
    overall: string;
    score: number;
    checks: SystemHealthDetail[];
    buildVersion: string;
    environment: string;
    checkedAt: string;
  };
  charts: {
    usersByRole: ChartPoint[];
    usersByDepartment: ChartPoint[];
    monthlyLoginTrend: ChartPoint[];
    moduleUsageTrend: ChartPoint[];
    auditActionsTrend: ChartPoint[];
  };
  dataQuality: {
    sampled: boolean;
    warnings: string[];
    fetchedAt: string;
  };
}

const EMPTY_CHART: ChartPoint[] = [{ name: 'No Data', value: 0 }];

async function safeDocs(
  collectionName: string,
  max = 500,
  constraints: QueryConstraint[] = [],
  warnings?: string[],
): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(
      query(collection(getFirebaseFirestore(), collectionName), ...constraints, limit(max))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    warnings?.push(`${collectionName}: ${(error as Error).message || 'query failed'}`);
    return [];
  }
}

async function safeCount(
  collectionName: string,
  constraints: QueryConstraint[] = [],
  warnings?: string[],
): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  try {
    const snap = await getCountFromServer(
      query(collection(getFirebaseFirestore(), collectionName), ...constraints),
    );
    return snap.data().count;
  } catch (error) {
    warnings?.push(`${collectionName} count: ${(error as Error).message || 'query failed'}`);
    return 0;
  }
}

async function countOpenRecords(
  collectionName: string,
  statusField = 'status',
  terminalStatuses: string[] = ['Closed', 'closed'],
  warnings?: string[],
): Promise<number> {
  const [total, terminal] = await Promise.all([
    safeCount(collectionName, [], warnings),
    safeCount(collectionName, [where(statusField, 'in', terminalStatuses)], warnings),
  ]);
  return Math.max(0, total - terminal);
}

function groupCount(items: Record<string, unknown>[], key: string, labelMap?: Record<string, string>): ChartPoint[] {
  const counts: Record<string, number> = {};
  items.forEach((item) => {
    const raw = String(item[key] ?? 'Unknown');
    const label = labelMap?.[raw] || raw.replace(/_/g, ' ');
    counts[label] = (counts[label] || 0) + 1;
  });
  const result = Object.entries(counts).map(([name, value]) => ({ name, value }));
  return result.length ? result : EMPTY_CHART;
}

function monthlyTrend(
  items: Record<string, unknown>[],
  dateKey: string,
  months = 6,
): ChartPoint[] {
  const monthMap = new Map<string, number>();
  items.forEach((item) => {
    const dt = String(item[dateKey] ?? '');
    if (!dt) return;
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthMap.set(key, (monthMap.get(key) || 0) + 1);
  });
  const entries = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return [{ name: 'N/A', value: 0 }];
  return entries.slice(-months).map(([key, value]) => {
    const [year, month] = key.split('-').map(Number);
    return {
      name: new Date(year, month - 1, 1).toLocaleString('default', {
        month: 'short',
        year: '2-digit',
      }),
      value,
    };
  });
}

function healthScore(status: string): number {
  if (status === 'Healthy') return 100;
  if (status === 'Degraded') return 65;
  return 25;
}

export async function getExtendedSystemHealth(): Promise<{
  overall: string;
  score: number;
  checks: SystemHealthDetail[];
  checkedAt: string;
}> {
  const checks: SystemHealthDetail[] = [];
  const firebase = await checkFirebaseConnection();

  checks.push({
    name: 'Firebase Connection',
    status: firebase.connected ? 'Healthy' : firebase.configured ? 'Degraded' : 'Down',
    detail: firebase.connected
      ? `Connected (${firebase.latencyMs}ms) — ${firebase.projectId}`
      : firebase.error || 'Not configured',
  });

  if (isFirebaseConfigured()) {
    try {
      await getDocs(query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.users), limit(1)));
      checks.push({ name: 'Firestore Read', status: 'Healthy', detail: 'Read test successful' });
    } catch (e) {
      checks.push({ name: 'Firestore Read', status: 'Down', detail: (e as Error).message });
    }

    const storageHealth = getFirebaseStorageHealthStatus();
    checks.push({
      name: 'Storage Configuration',
      status: storageHealth === 'Connected' ? 'Healthy' : storageHealth === 'Degraded' ? 'Degraded' : 'Down',
      detail:
        storageHealth === 'Connected'
          ? `Bucket configured (${process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}); object access not tested`
          : storageHealth === 'Degraded'
            ? 'Storage configured but Firebase connection degraded'
            : 'Storage bucket not configured',
    });

    try {
      const auth = getFirebaseAuth();
      checks.push({
        name: 'Auth SDK',
        status: auth ? 'Healthy' : 'Degraded',
        detail: auth.currentUser ? `Authenticated session: ${auth.currentUser.email}` : 'SDK initialized; no active session',
      });
    } catch (e) {
      checks.push({ name: 'Auth', status: 'Down', detail: (e as Error).message });
    }
  } else {
    checks.push(
      { name: 'Firestore Read', status: 'Down', detail: 'Firebase not configured' },
      { name: 'Storage Configuration', status: 'Down', detail: 'Firebase not configured' },
      { name: 'Auth SDK', status: 'Down', detail: 'Firebase not configured' },
    );
  }

  try {
    if (!isFirebaseConfigured()) throw new Error('not configured');
    const backupSnap = await getDocs(
      query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.backupRestore), orderBy('backupDateTime', 'desc'), limit(1))
    ).catch(() => null);
    const last = backupSnap?.docs[0]?.data();
    const lastBackupDate = last?.backupDateTime ?? last?.backupDate;
    const age = lastBackupDate
      ? Math.floor((Date.now() - new Date(String(lastBackupDate)).getTime()) / 86400000)
      : null;
    checks.push({
      name: 'Backup',
      status: age === null ? 'Degraded' : age > 7 ? 'Degraded' : 'Healthy',
      detail: age === null ? 'No backups found' : `Last backup ${age} day(s) ago`,
    });
  } catch {
    checks.push({ name: 'Backup', status: 'Degraded', detail: 'Cannot read backup log' });
  }

  const overall = checks.some((c) => c.status === 'Down')
    ? 'Down'
    : checks.some((c) => c.status === 'Degraded')
      ? 'Degraded'
      : 'Healthy';

  const score = Math.round(
    checks.reduce((sum, c) => sum + healthScore(c.status), 0) / checks.length
  );

  return { overall, score, checks, checkedAt: new Date().toISOString() };
}

export async function fetchAdminDashboardData(
  dateRange?: { startDate?: string; endDate?: string },
): Promise<AdminDashboardData> {
  const roleLabelMap = Object.fromEntries(ADMIN_ROLES.map((r) => [r.id, r.name]));
  const warnings: string[] = [];

  const [samples, metrics] = await Promise.all([
    Promise.all([
      safeDocs(ADMIN_COLLECTIONS.users, 500, [orderBy('createdAt', 'desc')], warnings),
      safeDocs(ADMIN_COLLECTIONS.roles, 200, [orderBy('createdAt', 'desc')], warnings),
      safeDocs(ADMIN_COLLECTIONS.departments, 500, [orderBy('createdAt', 'desc')], warnings),
      safeDocs(ADMIN_COLLECTIONS.loginActivity, 200, [orderBy('loginTime', 'desc')], warnings),
      safeDocs(ADMIN_COLLECTIONS.auditLogs, 300, [orderBy('dateTime', 'desc')], warnings),
      safeDocs(ADMIN_COLLECTIONS.auditTrail, 300, [orderBy('timestamp', 'desc')], warnings),
      safeDocs(ADMIN_COLLECTIONS.backupRestore, 50, [orderBy('backupDateTime', 'desc')], warnings),
      safeDocs(ADMIN_COLLECTIONS.notificationSettings, 100, [], warnings),
      safeDocs(ADMIN_COLLECTIONS.workflows, 100, [], warnings),
      safeDocs(ADMIN_COLLECTIONS.documentNumbering, 100, [], warnings),
      safeDocs(ADMIN_COLLECTIONS.systemSettings, 10, [], warnings),
      getExtendedSystemHealth(),
      checkFirebaseConnection(),
    ]),
    Promise.all([
      safeCount(ADMIN_COLLECTIONS.users, [], warnings),
      safeCount(ADMIN_COLLECTIONS.users, [where('userStatus', '==', 'Active')], warnings),
      safeCount(ADMIN_COLLECTIONS.users, [where('userStatus', '==', 'Inactive')], warnings),
      safeCount(ADMIN_COLLECTIONS.users, [where('userStatus', '==', 'Locked')], warnings),
      safeCount(ADMIN_COLLECTIONS.roles, [], warnings),
      safeCount(ADMIN_COLLECTIONS.departments, [], warnings),
      safeCount(ADMIN_COLLECTIONS.companySites, [], warnings),
      safeCount(ADMIN_COLLECTIONS.users, [where('userStatus', '==', 'Pending Approval')], warnings),
      safeCount(ADMIN_COLLECTIONS.auditLogs, [], warnings),
      safeCount(ADMIN_COLLECTIONS.auditTrail, [], warnings),
      safeCount('sop_reviews', [where('status', '==', 'in_progress')], warnings),
      countOpenRecords('capa_records', 'status', ['Closed', 'closed'], warnings),
      countOpenRecords('deviations', 'status', ['Closed', 'closed'], warnings),
      countOpenRecords('audits', 'status', ['Closed', 'closed'], warnings),
      countOpenRecords('risk_assessment', 'risk_status', ['Closed', 'Accepted', 'Rejected'], warnings),
      safeCount('equipment_master', [], warnings),
      countOpenRecords('complaints', 'status', ['Closed', 'closed'], warnings),
      countOpenRecords('change_controls', 'status', ['Closed', 'closed'], warnings),
      countOpenRecords('validation_records', 'validation_status', ['Approved', 'Rejected', 'Closed'], warnings),
      safeCount('notifications', [where('isRead', '==', false)], warnings),
    ]),
  ]);

  const [
    usersRaw, rolesRaw, departmentsRaw, loginRaw, auditLogsRaw, auditTrailRaw,
    backupsRaw, notificationsRaw, workflowsRaw, docNumRaw, settingsRaw, health, firebase,
  ] = samples as [
    Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[],
    Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[],
    Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[],
    Record<string, unknown>[], Record<string, unknown>[],
    Awaited<ReturnType<typeof getExtendedSystemHealth>>,
    Awaited<ReturnType<typeof checkFirebaseConnection>>,
  ];

  const [
    totalUsers, activeUsers, inactiveUsers, lockedUsers, totalRoles, totalDepartments,
    totalSites, pendingApprovalCount, auditLogCount, auditTrailCount,
    pendingSopReviews, openCapa, openDeviations, openAudits, openRisks, totalEquipment,
    openComplaints, openChangeControls, openValidations, unreadNotifications,
  ] = metrics;

  const users = usersRaw as AdminUser[];
  const pendingUserApprovals = users.filter((u) => u.userStatus === 'Pending Approval');

  const lastBackup = [...backupsRaw].sort((a, b) =>
    String(b.backupDateTime ?? b.backupDate ?? '').localeCompare(
      String(a.backupDateTime ?? a.backupDate ?? ''),
    )
  )[0];

  const kpis: DashboardKpis = {
    totalUsers,
    activeUsers,
    inactiveUsers,
    lockedUsers,
    totalRoles: totalRoles || rolesRaw.length || ADMIN_ROLES.length,
    totalDepartments,
    totalSites,
    pendingApprovals: pendingApprovalCount,
    totalAuditRecords: auditLogCount + auditTrailCount,
    firebaseStatus: firebase.connected ? 'Connected' : firebase.configured ? 'Degraded' : 'Not Configured',
    lastBackupStatus: lastBackup
      ? `${lastBackup.backupStatus || 'Success'} — ${new Date(String(lastBackup.backupDateTime ?? lastBackup.backupDate)).toLocaleDateString()}`
      : 'No backups',
    systemHealthScore: health.score,
  };

  let loginActivity: LoginActivityRow[] = loginRaw.map((l) => ({
    id: l.id as string,
    userName: String(l.userName ?? l.fullName ?? '-'),
    email: String(l.email ?? '-'),
    role: String(l.role ?? '-').replace(/_/g, ' '),
    loginTime: String(l.loginTime ?? l.createdAt ?? ''),
    deviceIp: `${String(l.deviceInfo ?? l.device ?? '-')} / ${String(l.ipAddress ?? '-')}`,
    status: String(l.loginStatus ?? l.status ?? 'Success'),
  }));

  const trailActions: AdminActionRow[] = auditTrailRaw.map((l) => ({
    id: l.id as string,
    module: String(l.moduleName ?? l.module ?? 'System'),
    action: String(l.action ?? '-'),
    userName: String(l.userName ?? '-'),
    dateTime: String(l.timestamp ?? l.dateTime ?? ''),
    status: String(l.status ?? 'Success'),
  }));

  const logActions: AdminActionRow[] = auditLogsRaw.map((l) => ({
    id: l.id as string,
    module: String(l.module ?? 'Admin'),
    action: String(l.action ?? '-'),
    userName: String(l.userName ?? '-'),
    dateTime: String(l.dateTime ?? ''),
    status: String(l.status ?? 'Success'),
  }));

  let recentActions = [...trailActions, ...logActions]
    .sort((a, b) => String(b.dateTime).localeCompare(String(a.dateTime)))
    .slice(0, 15);

  const pendingApprovals: PendingApprovalRow[] = [];

  pendingUserApprovals.forEach((u) => {
    pendingApprovals.push({
      id: `user-${u.id ?? u.employeeId}`,
      type: 'User Creation',
      title: `${u.fullName || u.email} — new user`,
      requestedBy: String(u.createdBy ?? 'System'),
      date: String(u.createdAt ?? ''),
      status: 'Pending Approval',
    });
  });

  workflowsRaw
    .filter((w) => w.status === 'Inactive')
    .slice(0, 5)
    .forEach((w) => {
      pendingApprovals.push({
        id: `workflow-${w.id}`,
        type: 'Workflow Change',
        title: String(w.moduleName ?? w.id),
        requestedBy: String(w.updatedBy ?? '-'),
        date: String(w.updatedAt ?? ''),
        status: 'Pending',
      });
    });

  docNumRaw
    .filter((d) => d.status === 'Inactive')
    .slice(0, 5)
    .forEach((d) => {
      pendingApprovals.push({
        id: `docnum-${d.id}`,
        type: 'Document Numbering',
        title: String(d.module ?? d.prefix ?? d.id),
        requestedBy: String(d.updatedBy ?? '-'),
        date: String(d.updatedAt ?? ''),
        status: 'Pending Review',
      });
    });

  if (settingsRaw.some((s) => s.maintenanceMode === true)) {
    pendingApprovals.push({
      id: 'settings-maintenance',
      type: 'System Setting',
      title: 'Maintenance mode enabled',
      requestedBy: 'System',
      date: String(settingsRaw[0]?.updatedAt ?? ''),
      status: 'Active',
    });
  }

  notificationsRaw
    .filter((n) => n.status === 'Inactive')
    .slice(0, 3)
    .forEach((n) => {
      pendingApprovals.push({
        id: `notif-${n.id}`,
        type: 'Notification Config',
        title: String(n.eventName ?? n.id),
        requestedBy: String(n.updatedBy ?? '-'),
        date: String(n.updatedAt ?? ''),
        status: 'Pending',
      });
    });

  if (dateRange?.startDate) {
    loginActivity = loginActivity.filter((l) => l.loginTime >= dateRange.startDate!);
    recentActions = recentActions.filter((a) => a.dateTime >= dateRange.startDate!);
  }
  if (dateRange?.endDate) {
    loginActivity = loginActivity.filter((l) => l.loginTime <= dateRange.endDate! + 'T23:59:59');
    recentActions = recentActions.filter((a) => a.dateTime <= dateRange.endDate! + 'T23:59:59');
  }

  const usersByRole = groupCount(users as Record<string, unknown>[], 'role', roleLabelMap);
  const usersByDepartment = groupCount(users as Record<string, unknown>[], 'department');
  const monthlyLoginTrend = monthlyTrend(loginRaw, 'loginTime');
  const normalizedAuditEvents = [
    ...auditTrailRaw.map((event) => ({
      ...event,
      eventDate: event.timestamp ?? event.dateTime,
    })),
    ...auditLogsRaw.map((event) => ({
      ...event,
      moduleName: event.module,
      eventDate: event.dateTime ?? event.timestamp,
    })),
  ];
  const auditActionsTrend = monthlyTrend(
    normalizedAuditEvents,
    'eventDate',
  );

  return {
    kpis,
    moduleKpis: [
      { label: 'Pending SOP Reviews', value: pendingSopReviews, href: '/qms/documents/sop' },
      { label: 'Open CAPA', value: openCapa, href: '/qms/capa' },
      { label: 'Open Deviations', value: openDeviations, href: '/qms/deviation' },
      { label: 'Open Audits', value: openAudits, href: '/qms/audit' },
      { label: 'Open Risks', value: openRisks, href: '/qms/risk-management' },
      { label: 'Equipment', value: totalEquipment, href: '/qms/equipment' },
      { label: 'Open Complaints', value: openComplaints, href: '/qms/complaints' },
      { label: 'Open Change Controls', value: openChangeControls, href: '/qms/change-control' },
      { label: 'Open Validations', value: openValidations, href: '/qms/validation' },
      { label: 'Unread Notifications', value: unreadNotifications, href: '/notifications' },
    ],
    loginActivity: loginActivity.slice(0, 10),
    recentActions,
    pendingApprovals: pendingApprovals.slice(0, 12),
    systemHealth: {
      overall: health.overall,
      score: health.score,
      checks: health.checks,
      buildVersion: process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0',
      environment: process.env.NODE_ENV || 'development',
      checkedAt: health.checkedAt,
    },
    charts: {
      usersByRole,
      usersByDepartment,
      monthlyLoginTrend,
      moduleUsageTrend: groupCount(
        normalizedAuditEvents,
        'moduleName',
      ),
      auditActionsTrend,
    },
    dataQuality: {
      sampled: totalUsers > usersRaw.length
        || auditLogCount > auditLogsRaw.length
        || auditTrailCount > auditTrailRaw.length,
      warnings: Array.from(new Set(warnings)),
      fetchedAt: new Date().toISOString(),
    },
  };
}

export async function logDashboardAudit(
  action: string,
  auditMeta: { userId: string; userName: string },
  detail?: string,
) {
  try {
    await logAuditEvent({
      userId: auditMeta.userId,
      userName: auditMeta.userName,
      module: 'Admin Dashboard',
      recordId: 'dashboard',
      action,
      oldValue: '',
      newValue: detail || action,
      reason: '',
      ipAddress: 'client',
      device: typeof navigator !== 'undefined' ? navigator.userAgent : 'browser',
      status: 'Success',
    });
  } catch {
    // non-blocking
  }
}

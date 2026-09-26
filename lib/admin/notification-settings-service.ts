import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import {
  applyTemplateVariables,
  sendInAppNotification,
  sendEmailNotificationPlaceholder,
  getAllNotifications,
  getNotificationStats,
} from '@/lib/notification-service';
import { ADMIN_COLLECTIONS } from './constants';
import type { NotificationSetting, NotificationSettingFormData } from './schemas';

export interface NotificationSettingAuditMeta {
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

function parseCsvList(value?: string): string[] {
  if (!value?.trim()) return [];
  return value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

export function buildNotificationSettingId(code: string): string {
  return `NTS-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function normalizeNotificationSetting(s: NotificationSetting): NotificationSetting {
  const beforeDue = Number(s.notifyBeforeDueDays ?? s.beforeDueDays ?? 3);
  const escalation = Number(s.escalationAfterDays ?? s.escalationDays ?? 7);
  return {
    ...s,
    notificationSettingId: s.notificationSettingId || buildNotificationSettingId(s.notificationCode || 'NTS'),
    eventAliases: Array.isArray(s.eventAliases) ? s.eventAliases : [],
    notifyBeforeDueDays: beforeDue,
    beforeDueDays: beforeDue,
    escalationAfterDays: escalation,
    escalationDays: escalation,
    enableInAppNotification: s.enableInAppNotification ?? s.inAppEnabled ?? true,
    inAppEnabled: s.enableInAppNotification ?? s.inAppEnabled ?? true,
    enableEmailNotification: s.enableEmailNotification ?? s.emailEnabled ?? true,
    emailEnabled: s.enableEmailNotification ?? s.emailEnabled ?? true,
    enableSmsNotification: s.enableSmsNotification ?? s.smsEnabled ?? false,
    smsEnabled: s.enableSmsNotification ?? s.smsEnabled ?? false,
    templateBody: s.templateBody || s.template || '',
    template: s.templateBody || s.template || '',
    repeatReminder: s.repeatReminder ?? false,
    reminderFrequency: (s.reminderFrequency as NotificationSetting['reminderFrequency']) || 'None',
    priority: (s.priority as NotificationSetting['priority']) || 'Medium',
    preventDuplicates: s.preventDuplicates ?? true,
    duplicateWindowMinutes: Number(s.duplicateWindowMinutes ?? 60),
  };
}

export function isNotificationSettingActive(s: NotificationSetting): boolean {
  return s.status === 'Active' && !s.isDeleted;
}

export async function fetchNotificationSettings(): Promise<NotificationSetting[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.notificationSettings),
      orderBy('updatedAt', 'desc'),
      limit(400),
    ));
    return snap.docs
      .map((d) => normalizeNotificationSetting({ id: d.id, ...d.data() } as NotificationSetting))
      .filter((s) => !s.isDeleted);
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.notificationSettings));
      return snap.docs
        .map((d) => normalizeNotificationSetting({ id: d.id, ...d.data() } as NotificationSetting))
        .filter((s) => !s.isDeleted);
    } catch {
      return [];
    }
  }
}

export function subscribeToNotificationSettings(
  onData: (rows: NotificationSetting[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  return onSnapshot(
    query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.notificationSettings), limit(400)),
    (snapshot) => {
      onData(snapshot.docs
        .map((d) => normalizeNotificationSetting({ id: d.id, ...d.data() } as NotificationSetting))
        .filter((s) => !s.isDeleted)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));
    },
    (error) => onError?.(new Error(error.message)),
  );
}

export async function fetchNotificationSettingById(id: string): Promise<NotificationSetting | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.notificationSettings, id));
    if (!snap.exists() || snap.data().isDeleted === true) return null;
    return normalizeNotificationSetting({ id: snap.id, ...snap.data() } as NotificationSetting);
  } catch {
    return null;
  }
}

export async function fetchActiveNotificationRules(
  moduleName: string,
  eventTrigger: string,
): Promise<NotificationSetting | null> {
  const settings = await fetchNotificationSettings();
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const m = norm(moduleName);
  const e = norm(eventTrigger);
  return settings.find((s) => {
    if (!isNotificationSettingActive(s)) return false;
    if (!norm(s.moduleName).includes(m) && !m.includes(norm(s.moduleName))) return false;
    const triggers = [s.eventTrigger, ...(s.eventAliases || [])];
    return triggers.some((t) => {
      const nt = norm(t);
      return nt === e || nt.includes(e) || e.includes(nt);
    });
  }) ?? null;
}

export function getNotificationSettingsSummary(settings: NotificationSetting[]) {
  return {
    total: settings.length,
    active: settings.filter((s) => s.status === 'Active').length,
    inactive: settings.filter((s) => s.status === 'Inactive').length,
    critical: settings.filter((s) => s.priority === 'Critical').length,
    emailEnabled: settings.filter((s) => s.enableEmailNotification).length,
    inAppEnabled: settings.filter((s) => s.enableInAppNotification).length,
  };
}

export async function getNotificationDeliveryStats() {
  const notifications = await getAllNotifications(500);
  const stats = getNotificationStats(notifications);
  return {
    unreadNotifications: stats.unread,
    failedNotifications: stats.failed,
  };
}

function formToCallable(data: NotificationSettingFormData, changeReason: string) {
  return {
    notificationCode: data.notificationCode,
    eventName: data.eventName,
    moduleName: data.moduleName,
    eventTrigger: data.eventTrigger,
    eventAliases: parseCsvList(data.eventAliases),
    notificationType: data.notificationType,
    recipientRole: data.recipientRole,
    recipientUserOptional: data.recipientUserOptional,
    recipientDepartmentOptional: data.recipientDepartmentOptional,
    ccRoleOptional: data.ccRoleOptional,
    escalationRole: data.escalationRole,
    notifyBeforeDueDays: data.notifyBeforeDueDays,
    escalationAfterDays: data.escalationAfterDays,
    repeatReminder: data.repeatReminder,
    reminderFrequency: data.reminderFrequency,
    templateSubject: data.templateSubject,
    templateBody: data.templateBody,
    priority: data.priority,
    enableInAppNotification: data.enableInAppNotification,
    enableEmailNotification: data.enableEmailNotification,
    enableSmsNotification: data.enableSmsNotification,
    remarks: data.remarks,
    changeReason,
  };
}

export async function createNotificationSetting(
  data: NotificationSettingFormData,
  meta: NotificationSettingAuditMeta,
): Promise<{ setting: NotificationSetting | null; error: string | null }> {
  try {
    const reason = data.changeReason || `Created by ${meta.userName}`;
    if (reason.trim().length < 5) return { setting: null, error: 'Change reason is required (min 5 characters)' };
    const fn = httpsCallable(getFirebaseFunctions(), 'createAdminNotificationSetting');
    const result = await fn(formToCallable(data, reason));
    const id = (result.data as { id?: string })?.id;
    return { setting: id ? await fetchNotificationSettingById(id) : null, error: null };
  } catch (e) {
    return { setting: null, error: callableErrorMessage(e, 'Unable to create notification rule') };
  }
}

export async function updateNotificationSetting(
  id: string,
  data: NotificationSettingFormData,
  _existing: NotificationSetting,
  meta: NotificationSettingAuditMeta,
): Promise<{ setting: NotificationSetting | null; error: string | null }> {
  try {
    const reason = data.changeReason || `Updated by ${meta.userName}`;
    if (reason.trim().length < 5) return { setting: null, error: 'Change reason is required (min 5 characters)' };
    const fn = httpsCallable(getFirebaseFunctions(), 'updateAdminNotificationSetting');
    await fn({ id, ...formToCallable(data, reason) });
    return { setting: await fetchNotificationSettingById(id), error: null };
  } catch (e) {
    return { setting: null, error: callableErrorMessage(e, 'Unable to update notification rule') };
  }
}

export async function setNotificationSettingStatus(
  id: string,
  setting: NotificationSetting,
  status: 'Active' | 'Inactive',
  meta: NotificationSettingAuditMeta,
  changeReason = '',
): Promise<{ success: boolean; error?: string }> {
  try {
    const reason = changeReason || `${status === 'Active' ? 'Activated' : 'Deactivated'} by ${meta.userName}`;
    const fn = httpsCallable(getFirebaseFunctions(), 'setAdminNotificationSettingStatus');
    await fn({ id, status, changeReason: reason });
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Unable to update status') };
  }
}

export async function softDeleteNotificationSetting(
  id: string,
  meta: NotificationSettingAuditMeta,
  changeReason = '',
): Promise<{ success: boolean; error?: string }> {
  try {
    const reason = changeReason || `Soft-deleted by ${meta.userName}`;
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminNotificationSetting');
    await fn({ id, changeReason: reason });
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Unable to delete rule') };
  }
}

export function previewNotificationTemplate(
  setting: Partial<NotificationSetting>,
  vars?: Record<string, string>,
): { subject: string; body: string } {
  const sample: Record<string, string> = {
    documentNumber: 'DOC-2026-0001',
    DocumentNo: 'DOC-2026-0001',
    moduleName: setting.moduleName || 'PQR',
    Module: setting.moduleName || 'PQR',
    eventName: setting.eventName || 'Event',
    productName: 'Amoxicillin 500mg',
    batchNumber: 'BTH-2026-0042',
    assignedTo: 'QA Executive',
    dueDate: '2026-03-15',
    DueDate: '2026-03-15',
    status: 'Pending Approval',
    Status: 'Pending Approval',
    createdBy: 'Admin User',
    siteName: 'HMF Plant',
    UserName: 'Jane Doe',
    EmployeeName: 'Jane Doe',
    Department: 'QA',
    Approver: 'Head QA',
    Workflow: 'CAPA Approval',
    ...vars,
  };
  const subject = applyTemplateVariables(setting.templateSubject || '[{{moduleName}}] {{eventName}}', sample);
  const body = applyTemplateVariables(setting.templateBody || setting.template || '', sample);
  return { subject, body };
}

export async function sendTestNotification(
  setting: NotificationSetting,
  meta: NotificationSettingAuditMeta,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'dispatchAdminNotificationEvent');
    await fn({
      moduleName: setting.moduleName,
      eventTrigger: setting.eventTrigger,
      recordId: setting.id || 'test',
      documentNumber: 'TEST-0001',
      title: `Test: ${setting.eventName}`,
      message: setting.templateBody,
      fallbackUserId: meta.userId,
      userName: meta.userName,
      createdBy: meta.userName,
      status: 'Test',
    });
    // Also send direct in-app for immediate feedback
    const { subject, body } = previewNotificationTemplate(setting);
    if (setting.enableInAppNotification) {
      await sendInAppNotification({
        userId: meta.userId,
        moduleName: setting.moduleName,
        eventName: setting.eventName,
        recordId: setting.id || 'test',
        documentNumber: 'TEST-0001',
        title: subject || `Test: ${setting.eventName}`,
        message: body,
        type: 'info',
        priority: setting.priority,
        recipientRole: setting.recipientRole,
        actionLink: '/notifications',
      });
    }
    if (setting.enableEmailNotification) {
      await sendEmailNotificationPlaceholder({
        userId: meta.userId,
        moduleName: setting.moduleName,
        eventName: setting.eventName,
        recordId: setting.id || 'test',
        title: subject || `Test: ${setting.eventName}`,
        message: body,
        subject: subject || `Test: ${setting.eventName}`,
      });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Test notification failed') };
  }
}

export function exportNotificationSettingsCsv(settings: NotificationSetting[]): string {
  const headers = [
    'Code', 'Event', 'Module', 'Trigger', 'Role', 'Priority', 'In-App', 'Email', 'SMS', 'Status',
  ];
  const rows = settings.map((s) => [
    s.notificationCode, s.eventName, s.moduleName, s.eventTrigger, s.recipientRole,
    s.priority,
    s.enableInAppNotification ? 'Yes' : 'No',
    s.enableEmailNotification ? 'Yes' : 'No',
    s.enableSmsNotification ? 'Yes' : 'No',
    s.status,
  ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
  return `\uFEFF${[headers.join(','), ...rows].join('\n')}`;
}

export async function logNotificationSettingsExport(
  meta: NotificationSettingAuditMeta,
  count: number,
): Promise<void> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminNotificationSettingsExport');
    await fn({ format: 'Excel', count, userName: meta.userName });
  } catch (error) {
    console.error('NOTIFICATION_SETTINGS_FAILURE: export log', error);
  }
}

export async function seedDefaultNotificationSettings(
  meta: NotificationSettingAuditMeta,
): Promise<{ created: number; skipped: number }> {
  try {
    const fn = httpsCallable<
      { changeReason: string },
      { created: number; skipped: number }
    >(getFirebaseFunctions(), 'seedAdminNotificationSettings');
    const result = await fn({ changeReason: `Seeded by ${meta.userName}` });
    return { created: result.data.created || 0, skipped: result.data.skipped || 0 };
  } catch {
    return { created: 0, skipped: 0 };
  }
}

export async function dispatchNotificationEvent(payload: Record<string, unknown>) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'dispatchAdminNotificationEvent');
    const result = await fn(payload);
    return { data: result.data as { delivered: number; queued: number }, error: null as string | null };
  } catch (e) {
    return { data: null, error: callableErrorMessage(e, 'Unable to dispatch notification') };
  }
}

export async function processNotificationQueue() {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'processAdminNotificationQueue');
    const result = await fn({});
    return { data: result.data as { processed: number; failed: number }, error: null as string | null };
  } catch (e) {
    return { data: null, error: callableErrorMessage(e, 'Unable to process queue') };
  }
}

export async function broadcastNotification(payload: Record<string, unknown>) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'broadcastAdminNotification');
    const result = await fn(payload);
    return { data: result.data as { delivered: number }, error: null as string | null };
  } catch (e) {
    return { data: null, error: callableErrorMessage(e, 'Unable to broadcast') };
  }
}

export async function archiveNotifications(beforeDate: string, changeReason: string) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'archiveAdminNotifications');
    const result = await fn({ beforeDate, changeReason });
    return { data: result.data as { archived: number }, error: null as string | null };
  } catch (e) {
    return { data: null, error: callableErrorMessage(e, 'Unable to archive notifications') };
  }
}

export async function fetchNotificationQueue(): Promise<Array<Record<string, unknown>>> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.notificationQueue),
      orderBy('createdAt', 'desc'),
      limit(200),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.notificationQueue));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      return [];
    }
  }
}

export async function fetchNotificationDeliveryLog(): Promise<Array<Record<string, unknown>>> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.notificationDeliveryLog),
      orderBy('createdAt', 'desc'),
      limit(300),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.notificationDeliveryLog));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    } catch {
      return [];
    }
  }
}

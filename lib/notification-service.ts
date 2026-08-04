import {
  collection, doc, addDoc, updateDoc, query, where, orderBy, limit,
  arrayUnion, onSnapshot, getDoc, getDocs, writeBatch, type Unsubscribe,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { ADMIN_COLLECTIONS } from '@/lib/admin/constants';
import { canDeleteRecords } from '@/lib/permissions';

export const NOTIFICATIONS_COLLECTION = 'notifications';

export type NotificationType = 'info' | 'warning' | 'error' | 'success' | 'due_date' | 'approval';

export interface NotificationRecord {
  id?: string;
  notificationId?: string;
  userId: string;
  recipientUserId?: string;
  title: string;
  message: string;
  type: NotificationType;
  moduleName: string;
  eventName?: string;
  recordId: string;
  documentNumber?: string;
  recipientRole?: string;
  recipientDepartment?: string;
  priority?: string;
  notificationChannel?: string;
  readStatus?: 'Unread' | 'Read';
  sentStatus?: 'Pending' | 'Sent' | 'Failed';
  isRead: boolean;
  actionLink?: string;
  createdAt: string;
  readAt?: string | null;
  readBy?: string[];
  readAtBy?: Record<string, string>;
}

export interface CreateNotificationInput {
  userId: string;
  moduleName: string;
  eventName: string;
  recordId: string;
  documentNumber?: string;
  title: string;
  message: string;
  type?: NotificationType;
  recipientRole?: string;
  recipientDepartment?: string;
  priority?: string;
  notificationChannel?: string;
  actionLink?: string;
  settingId?: string;
}

export interface TemplateVariables {
  documentNumber?: string;
  moduleName?: string;
  productName?: string;
  batchNumber?: string;
  assignedTo?: string;
  dueDate?: string;
  status?: string;
  createdBy?: string;
  siteName?: string;
}

function nowIso() {
  return new Date().toISOString();
}

function buildNotificationId() {
  return `NTF-${Date.now().toString(36).toUpperCase()}`;
}

export function applyTemplateVariables(
  template: string,
  vars: TemplateVariables | Record<string, string | undefined | null>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = (vars as Record<string, string | undefined | null>)[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<NotificationRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const db = getFirebaseFirestore();
    const notificationId = buildNotificationId();
    const payload: NotificationRecord = {
      notificationId,
      userId: input.userId,
      recipientUserId: input.userId,
      title: input.title,
      message: input.message,
      type: input.type || 'info',
      moduleName: input.moduleName,
      eventName: input.eventName,
      recordId: input.recordId,
      documentNumber: input.documentNumber || '',
      recipientRole: input.recipientRole || '',
      recipientDepartment: input.recipientDepartment || '',
      priority: input.priority || 'Medium',
      notificationChannel: input.notificationChannel || 'In-App',
      readStatus: 'Unread',
      sentStatus: 'Sent',
      isRead: false,
      actionLink: input.actionLink || '',
      createdAt: nowIso(),
      readAt: null,
      readBy: [],
      readAtBy: {},
    };
    const docRef = await addDoc(collection(db, NOTIFICATIONS_COLLECTION), payload);

    await createAuditLog({
      moduleName: input.moduleName,
      collectionName: NOTIFICATIONS_COLLECTION,
      recordId: input.recordId,
      documentNumber: input.documentNumber,
      actionType: 'Update',
      actionDescription: 'Notification sent',
      user: { id: input.userId, name: input.userId },
      status: 'Success',
      newValue: { title: input.title, channel: input.notificationChannel },
    });

    return { id: docRef.id, ...payload };
  } catch (error) {
    console.error('Failed to create notification:', error);
    return null;
  }
}

export async function sendInAppNotification(
  input: CreateNotificationInput,
): Promise<NotificationRecord | null> {
  return createNotification({ ...input, notificationChannel: 'In-App' });
}

export async function sendEmailNotificationPlaceholder(
  input: CreateNotificationInput & { subject: string },
): Promise<{ success: boolean; message: string }> {
  console.info('[Email placeholder]', input.subject, input.message);
  const record = await createNotification({
    ...input,
    notificationChannel: 'Email',
    title: input.subject,
  });
  if (!record) {
    await createAuditLog({
      moduleName: input.moduleName,
      collectionName: NOTIFICATIONS_COLLECTION,
      recordId: input.recordId,
      actionType: 'Update',
      actionDescription: 'Email notification failed (placeholder)',
      user: { id: input.userId, name: input.userId },
      status: 'Failed',
    });
    return { success: false, message: 'Failed to queue email notification' };
  }
  return { success: true, message: 'Email notification queued (placeholder — integrate SMTP/API later)' };
}

export async function markNotificationAsRead(
  notificationId: string,
  actor?: { id: string; name: string },
): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    const db = getFirebaseFirestore();
    const notificationRef = doc(db, NOTIFICATIONS_COLLECTION, notificationId);
    const notification = await getDoc(notificationRef);
    if (!notification.exists()) return false;
    if (notification.data().recipientRole) {
      if (!actor?.id) return false;
      await updateDoc(notificationRef, {
        readBy: arrayUnion(actor.id),
        [`readAtBy.${actor.id}`]: nowIso(),
      });
    } else {
      await updateDoc(notificationRef, {
        isRead: true,
        readStatus: 'Read',
        readAt: nowIso(),
      });
    }
    await createAuditLog({
      moduleName: 'Admin',
      collectionName: NOTIFICATIONS_COLLECTION,
      recordId: notificationId,
      actionType: 'Update',
      actionDescription: 'Notification read',
      user: actor || { id: 'system', name: 'System' },
      status: 'Success',
    });
    return true;
  } catch (error) {
    console.error('Failed to mark notification read:', error);
    return false;
  }
}

/** @deprecated use markNotificationAsRead */
export async function markNotificationRead(notificationId: string): Promise<boolean> {
  return markNotificationAsRead(notificationId);
}

/**
 * Permanently deletes all in-app notifications (Super Admin only).
 * Use to clear leftover test/demo alerts so the inbox reflects live workflow events only.
 */
export async function clearAllNotifications(
  actor: { id: string; name: string; role?: string | null },
): Promise<{ success: boolean; deleted: number; error?: string }> {
  if (!isFirebaseConfigured()) {
    return { success: false, deleted: 0, error: 'Firebase is not configured.' };
  }
  if (!canDeleteRecords(actor.role)) {
    return { success: false, deleted: 0, error: 'Only Super Admin can clear all notifications.' };
  }
  try {
    const db = getFirebaseFirestore();
    let deleted = 0;
    // Firestore batches max 500 writes; page until empty.
    for (;;) {
      const snap = await getDocs(query(collection(db, NOTIFICATIONS_COLLECTION), limit(400)));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
      if (snap.size < 400) break;
    }
    await createAuditLog({
      moduleName: 'Admin',
      collectionName: NOTIFICATIONS_COLLECTION,
      recordId: 'clear-all',
      actionType: 'Delete',
      actionDescription: `Cleared ${deleted} notifications`,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    return { success: true, deleted };
  } catch (error) {
    console.error('Failed to clear notifications:', error);
    return {
      success: false,
      deleted: 0,
      error: error instanceof Error ? error.message : 'Failed to clear notifications',
    };
  }
}

export async function markAllNotificationsRead(
  userId: string,
  actor?: { id: string; name: string },
  recipientRole?: string,
): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;
  try {
    const db = getFirebaseFirestore();
    const q = query(
      collection(db, NOTIFICATIONS_COLLECTION),
      where('userId', '==', userId),
      where('isRead', '==', false),
    );
    const [snap, roleSnap] = await Promise.all([
      getDocs(q),
      recipientRole
        ? getDocs(query(
          collection(db, NOTIFICATIONS_COLLECTION),
          where('recipientRole', '==', recipientRole),
        ))
        : Promise.resolve(null),
    ]);
    const roleUnreadDocs = (roleSnap?.docs || [])
      .filter((d) => !((d.data().readBy as string[] | undefined) || []).includes(userId));
    await Promise.all(
      [
        ...snap.docs.map((d) => updateDoc(d.ref, { isRead: true, readStatus: 'Read', readAt: nowIso() })),
        ...roleUnreadDocs.map((d) => updateDoc(d.ref, {
            readBy: arrayUnion(userId),
            [`readAtBy.${userId}`]: nowIso(),
          })),
      ],
    );
    const updatedCount = snap.size + roleUnreadDocs.length;
    if (updatedCount > 0) {
      await createAuditLog({
        moduleName: 'Admin',
        collectionName: NOTIFICATIONS_COLLECTION,
        recordId: userId,
        actionType: 'Update',
        actionDescription: `Marked ${updatedCount} notifications as read`,
        user: actor || { id: userId, name: 'User' },
        status: 'Success',
      });
    }
    return true;
  } catch (error) {
    console.error('Failed to mark all notifications read:', error);
    return false;
  }
}

export async function getUserNotifications(userId: string, max = 50): Promise<NotificationRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const db = getFirebaseFirestore();
    const q = query(
      collection(db, NOTIFICATIONS_COLLECTION),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(max),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => normalizeNotification({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Failed to fetch notifications:', error);
    return [];
  }
}

export async function getNotificationById(id: string): Promise<NotificationRecord | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseFirestore(), NOTIFICATIONS_COLLECTION, id));
    if (!snapshot.exists()) return null;
    return normalizeNotification({ id: snapshot.id, ...snapshot.data() });
  } catch {
    return null;
  }
}

export async function getAllNotifications(max = 500): Promise<NotificationRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const db = getFirebaseFirestore();
    const q = query(collection(db, NOTIFICATIONS_COLLECTION), orderBy('createdAt', 'desc'), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map((d) => normalizeNotification({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export function normalizeNotification(raw: Record<string, unknown>): NotificationRecord {
  const userId = String(raw.userId || raw.user_id || raw.recipientUserId || '');
  const isRead = Boolean(raw.isRead ?? raw.read);
  return {
    id: raw.id as string | undefined,
    notificationId: String(raw.notificationId || raw.id || ''),
    userId,
    recipientUserId: String(raw.recipientUserId || raw.userId || raw.user_id || ''),
    title: String(raw.title || ''),
    message: String(raw.message || ''),
    type: (raw.type as NotificationType) || 'info',
    moduleName: String(raw.moduleName || raw.module || ''),
    eventName: String(raw.eventName || ''),
    recordId: String(raw.recordId || raw.record_id || ''),
    documentNumber: String(raw.documentNumber || ''),
    recipientRole: String(raw.recipientRole || raw.target_role || ''),
    recipientDepartment: String(raw.recipientDepartment || ''),
    priority: String(raw.priority || 'Medium'),
    notificationChannel: String(raw.notificationChannel || 'In-App'),
    readStatus: (raw.readStatus as NotificationRecord['readStatus']) || (isRead ? 'Read' : 'Unread'),
    sentStatus: (raw.sentStatus as NotificationRecord['sentStatus']) || 'Sent',
    isRead,
    actionLink: String(raw.actionLink || ''),
    createdAt: String(raw.createdAt || raw.created_at || ''),
    readAt: raw.readAt ? String(raw.readAt) : null,
    readBy: Array.isArray(raw.readBy) ? raw.readBy.map(String) : [],
    readAtBy: raw.readAtBy && typeof raw.readAtBy === 'object'
      ? raw.readAtBy as Record<string, string>
      : {},
  };
}

const NOTIFICATION_MODULE_ROUTES: Record<string, { base: string; detail?: boolean }> = {
  document: { base: '/qms/dms', detail: true },
  documents: { base: '/qms/dms', detail: true },
  dms: { base: '/qms/dms', detail: true },
  capa: { base: '/qms/capa', detail: true },
  deviation: { base: '/qms/deviation', detail: true },
  audit: { base: '/qms/audit', detail: true },
  risk: { base: '/qms/risk-management', detail: true },
  equipment: { base: '/qms/equipment', detail: true },
  calibration: { base: '/qms/equipment/calibration-schedule' },
  complaint: { base: '/qms/complaints', detail: true },
  complaints: { base: '/qms/complaints', detail: true },
  'change control': { base: '/qms/change-control', detail: true },
  change_control: { base: '/qms/change-control', detail: true },
  validation: { base: '/qms/validation', detail: true },
  admin: { base: '/admin' },
};

/** Returns a same-origin route and rejects executable or cross-origin notification links. */
export function getNotificationActionLink(notification: NotificationRecord): string {
  const configured = notification.actionLink?.trim();
  if (configured?.startsWith('/') && !configured.startsWith('//')) return configured;

  const route = NOTIFICATION_MODULE_ROUTES[notification.moduleName.trim().toLowerCase()];
  if (!route) return notification.id ? `/notifications/${encodeURIComponent(notification.id)}` : '/notifications';
  if (route.detail && notification.recordId) {
    return `${route.base}/${encodeURIComponent(notification.recordId)}`;
  }
  return route.base;
}

export function subscribeToNotifications(
  userId: string,
  onData: (notifications: NotificationRecord[]) => void,
  onError?: (error: Error) => void,
  max = 25,
  recipientRole?: string,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }

  let active = true;
  let unsubscribers: Unsubscribe[] = [];
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryAttempt = 0;
  const resultSets = new Map<string, NotificationRecord[]>();

  const notificationQueries = () => {
    const db = getFirebaseFirestore();
    // Query both camelCase (new writers) and snake_case (legacy docs in Firestore).
    const queries = [
      {
        key: 'user',
        value: query(
          collection(db, NOTIFICATIONS_COLLECTION),
          where('userId', '==', userId),
          orderBy('createdAt', 'desc'),
          limit(max),
        ),
      },
      {
        key: 'user_legacy',
        value: query(
          collection(db, NOTIFICATIONS_COLLECTION),
          where('user_id', '==', userId),
          orderBy('created_at', 'desc'),
          limit(max),
        ),
      },
    ];
    if (recipientRole) {
      queries.push(
        {
          key: 'role',
          value: query(
            collection(db, NOTIFICATIONS_COLLECTION),
            where('recipientRole', '==', recipientRole),
            orderBy('createdAt', 'desc'),
            limit(max),
          ),
        },
        {
          key: 'role_legacy',
          value: query(
            collection(db, NOTIFICATIONS_COLLECTION),
            where('target_role', '==', recipientRole),
            orderBy('created_at', 'desc'),
            limit(max),
          ),
        },
      );
    }
    return queries;
  };

  const emitResults = () => {
    const unique = new Map<string, NotificationRecord>();
    resultSets.forEach((records) => {
      records.forEach((record) => unique.set(record.id || record.notificationId || '', record));
    });
    onData(
      Array.from(unique.values())
        .map((record): NotificationRecord => record.recipientRole
          ? {
            ...record,
            isRead: record.readBy?.includes(userId) || false,
            readStatus: record.readBy?.includes(userId) ? 'Read' : 'Unread',
            readAt: record.readAtBy?.[userId] || null,
          }
          : record)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, max),
    );
  };

  const fetchOnce = async () => {
    const results = await Promise.allSettled(
      notificationQueries().map(async ({ key, value }) => ({ key, snapshot: await getDocs(value) })),
    );
    if (!active) return;
    let sawPermissionError: Error | undefined;
    let sawSuccess = false;
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        sawSuccess = true;
        const { key, snapshot } = result.value;
        resultSets.set(key, snapshot.docs.map((d) => normalizeNotification({ id: d.id, ...d.data() })));
        return;
      }
      const err = result.reason as Error;
      if ((err as { code?: string })?.code === 'permission-denied') {
        sawPermissionError = err;
      } else {
        console.error('Notification poll error:', err);
      }
    });
    if (sawSuccess) {
      emitResults();
      return;
    }
    if (sawPermissionError) {
      console.error('Notification poll error:', sawPermissionError);
      onError?.(sawPermissionError);
    }
  };

  const startPolling = () => {
    if (pollTimer) return;
    void fetchOnce();
    pollTimer = setInterval(() => {
      void fetchOnce();
    }, 30_000);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const attachListener = () => {
    if (!active) return;
    try {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribers = notificationQueries().map(({ key, value }) =>
        onSnapshot(
          value,
          (snap) => {
            retryAttempt = 0;
            stopPolling();
            resultSets.set(key, snap.docs.map((d) => normalizeNotification({ id: d.id, ...d.data() })));
            emitResults();
          },
          (error) => {
            console.warn('Notification listener error (will retry):', error);
            onError?.(error);
            unsubscribers.forEach((unsubscribe) => unsubscribe());
            unsubscribers = [];
            startPolling();

            if (!active) return;
            const delay = Math.min(30_000, 2_000 * 2 ** retryAttempt);
            retryAttempt += 1;
            retryTimer = setTimeout(() => {
              if (active) attachListener();
            }, delay);
          },
        ),
      );
    } catch (error) {
      console.error('Failed to subscribe to notifications:', error);
      onError?.(error as Error);
      startPolling();
    }
  };

  attachListener();

  return () => {
    active = false;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    stopPolling();
    if (retryTimer) clearTimeout(retryTimer);
  };
}

export async function notifyApprovalPending(
  userId: string,
  moduleName: string,
  recordId: string,
  title: string,
  message: string,
) {
  return createNotification({
    userId,
    title,
    message,
    type: 'approval',
    moduleName,
    eventName: 'Approval Pending',
    recordId,
  });
}

export function getNotificationStats(notifications: NotificationRecord[]) {
  return {
    unread: notifications.filter((n) => !n.isRead || n.readStatus === 'Unread').length,
    failed: notifications.filter((n) => n.sentStatus === 'Failed').length,
    critical: notifications.filter((n) => n.priority === 'Critical').length,
  };
}

/**
 * Rule-driven dispatch via Admin Notification Settings Cloud Function.
 * Prefer this over ad-hoc createNotification when module events should honor configured rules.
 */
export async function dispatchNotificationEvent(payload: {
  moduleName: string;
  eventTrigger: string;
  recordId: string;
  documentNumber?: string;
  title?: string;
  message?: string;
  fallbackUserId?: string;
  userName?: string;
  employeeName?: string;
  department?: string;
  workflow?: string;
  approver?: string;
  dueDate?: string;
  status?: string;
  assignedTo?: string;
  createdBy?: string;
  productName?: string;
  batchNumber?: string;
  siteName?: string;
  moduleAlias?: string;
}): Promise<{ delivered: number; queued: number; rulesMatched?: number; error?: string }> {
  try {
    const { getFirebaseFunctions } = await import('@/lib/firebase');
    const { httpsCallable } = await import('firebase/functions');
    const fn = httpsCallable(getFirebaseFunctions(), 'dispatchAdminNotificationEvent');
    const result = await fn(payload);
    const data = result.data as { delivered?: number; queued?: number; rulesMatched?: number };
    return {
      delivered: data.delivered || 0,
      queued: data.queued || 0,
      rulesMatched: data.rulesMatched,
    };
  } catch (e) {
    const err = e as { message?: string };
    console.error('dispatchNotificationEvent failed', e);
    return {
      delivered: 0,
      queued: 0,
      error: err.message || 'Unable to dispatch notification event',
    };
  }
}

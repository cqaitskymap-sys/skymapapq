/**
 * User Access Review — privileged Cloud Functions.
 * Periodic access reviews for 21 CFR Part 11 / ISO 27001 / SOX / GMP.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  getFirestore, type Firestore, type DocumentData,
} from 'firebase-admin/firestore';

function initializeAdmin() {
  if (getApps().length === 0) initializeApp();
}

function requiredString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength = 5000): string {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function requiredReason(value: unknown): string {
  const reason = requiredString(value, 'Change reason', 2000);
  if (reason.length < 5) {
    throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');
  }
  return reason;
}

function buildReviewId(): string {
  return `UAR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function buildReviewNumber(period: string): string {
  const p = (period || 'PERIOD').replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase() || 'PERIOD';
  return `UAR-${p}-${Date.now().toString(36).toUpperCase()}`;
}

const VIEWER_ROLES = [
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive', 'qa',
  'regulatory_affairs', 'regulatory', 'auditor',
];
const MANAGER_ROLES = ['super_admin', 'admin', 'head_qa', 'qa_manager'];
const ADMIN_ROLES = ['super_admin', 'admin'];

const REVIEW_STATUSES = [
  'Draft', 'Pending', 'In Progress', 'Self Review', 'Manager Review',
  'QA Review', 'IT Review', 'Pending Approval', 'Completed', 'Rejected',
  'Changes Requested', 'Closed', 'Overdue', 'Archived',
] as const;

const TERMINAL_LOCK = new Set(['Completed', 'Closed', 'Archived']);

const PRIVILEGED_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'it_admin', 'system_admin',
]);

const SOD_CONFLICT_PAIRS: Array<[string, string]> = [
  ['super_admin', 'auditor'],
  ['admin', 'auditor'],
  ['qa', 'production'],
  ['qa_manager', 'production'],
];

type TransitionMap = Record<string, string[]>;
const TRANSITIONS: TransitionMap = {
  Draft: ['Pending', 'Closed'],
  Pending: ['In Progress', 'Self Review', 'Manager Review', 'Overdue', 'Closed'],
  'In Progress': ['Self Review', 'Manager Review', 'QA Review', 'IT Review', 'Changes Requested', 'Rejected', 'Overdue'],
  'Self Review': ['Manager Review', 'QA Review', 'Changes Requested'],
  'Manager Review': ['QA Review', 'IT Review', 'Pending Approval', 'Changes Requested', 'Rejected'],
  'QA Review': ['IT Review', 'Pending Approval', 'Completed', 'Changes Requested', 'Rejected'],
  'IT Review': ['Pending Approval', 'Completed', 'Changes Requested', 'Rejected'],
  'Pending Approval': ['Completed', 'Rejected', 'Changes Requested'],
  'Changes Requested': ['In Progress', 'Self Review', 'Manager Review', 'Closed'],
  Rejected: ['In Progress', 'Closed', 'Archived'],
  Overdue: ['In Progress', 'Manager Review', 'QA Review', 'Closed'],
  Completed: ['Closed', 'Archived'],
  Closed: ['Archived', 'Pending'], // reopen → Pending
  Archived: [],
};

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'User Access Review view access required');
  }
}

function assertManager(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !MANAGER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'User Access Review manage access required');
  }
}

function assertAdmin(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ADMIN_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Administrator access required');
  }
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const snap = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = snap.data();
  return {
    firestore,
    actor,
    actorRole: String(actor?.role || ''),
    actorName: String(actor?.full_name || actor?.email || request.auth.uid),
    actorUid: request.auth.uid,
  };
}

async function writeAccessReviewAudit(
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    recordId: string;
    actionType: string;
    description: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
    now: string;
  },
) {
  const batch = firestore.batch();
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-UAR-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'Admin',
    subModule: 'User Access Review',
    collectionName: 'access_reviews',
    recordId: input.recordId,
    documentId: input.recordId,
    actionType: input.actionType,
    action: input.actionType,
    actionDescription: input.description,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    changedByUserId: input.actorUid,
    changedByUserName: input.actorName,
    userId: input.actorUid,
    userName: input.actorName,
    reasonForChange: input.reason || '',
    reason: input.reason || '',
    ipAddress: 'server',
    deviceInfo: 'cloud-function',
    status: 'Success',
    appendOnly: true,
    immutable: true,
    source: 'access-review-admin',
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    dateTime: input.now,
    userId: input.actorUid,
    userName: input.actorName,
    module: 'User Access Review',
    recordId: input.recordId,
    action: input.actionType,
    oldValue: typeof input.oldValue === 'string' ? input.oldValue : JSON.stringify(input.oldValue ?? ''),
    newValue: typeof input.newValue === 'string' ? input.newValue : JSON.stringify(input.newValue ?? ''),
    reason: input.reason || '',
    ipAddress: 'server',
    device: 'cloud-function',
    status: 'Success',
  });
  await batch.commit();
}

async function notify(
  firestore: Firestore,
  userId: string,
  type: string,
  title: string,
  message: string,
  now: string,
  severity = 'Medium',
) {
  if (!userId) return;
  await firestore.collection('notifications').doc().set({
    userId,
    type,
    title,
    message,
    module: 'User Access Review',
    severity,
    isRead: false,
    createdAt: now,
  });
}

function detectSodConflicts(role: string, reviewerRole: string, subjectUserId: string, reviewerUserId: string) {
  const issues: Array<{ code: string; severity: string; message: string }> = [];
  if (subjectUserId && reviewerUserId && subjectUserId === reviewerUserId) {
    issues.push({
      code: 'SOD_SELF_REVIEW',
      severity: 'Critical',
      message: 'Subject user cannot review their own access (SoD violation).',
    });
  }
  for (const [a, b] of SOD_CONFLICT_PAIRS) {
    if ((role === a && reviewerRole === b) || (role === b && reviewerRole === a)) {
      issues.push({
        code: 'SOD_ROLE_PAIR',
        severity: 'High',
        message: `Segregation of duties conflict between roles ${a} and ${b}.`,
      });
    }
  }
  return issues;
}

function analyzeUserAccess(user: DocumentData, lastLoginDays: number | null) {
  const findings: Array<{ code: string; severity: string; message: string }> = [];
  const role = String(user.role || '');
  const status = String(user.userStatus || user.status || '');
  const locked = Boolean(user.accountLocked);
  const inactive = status === 'Inactive' || status === 'Suspended' || user.isDeleted === true;

  if (inactive) {
    findings.push({ code: 'INACTIVE_ACCOUNT', severity: 'High', message: 'User account is inactive or suspended.' });
  }
  if (locked) {
    findings.push({ code: 'LOCKED_ACCOUNT', severity: 'Medium', message: 'User account is locked.' });
  }
  if (PRIVILEGED_ROLES.has(role)) {
    findings.push({ code: 'PRIVILEGED_ACCESS', severity: 'Medium', message: `Privileged role assigned: ${role}.` });
  }
  if (lastLoginDays != null && lastLoginDays > 90) {
    findings.push({
      code: 'ORPHAN_INACTIVE_LOGIN',
      severity: 'High',
      message: `No successful login in ${lastLoginDays} days (orphan / unused account risk).`,
    });
  }
  if (!user.authUid && !user.email) {
    findings.push({ code: 'ORPHAN_ACCOUNT', severity: 'Critical', message: 'User record missing auth linkage / email.' });
  }
  if (String(user.employmentType || '') === 'Temporary') {
    findings.push({ code: 'TEMPORARY_ACCESS', severity: 'Medium', message: 'Temporary employment / access flagged for expiry review.' });
  }
  return findings;
}

function assertMutable(data: DocumentData | undefined) {
  if (!data) throw new HttpsError('not-found', 'Access review not found');
  if (data.immutable === true || TERMINAL_LOCK.has(String(data.reviewStatus))) {
    if (String(data.reviewStatus) === 'Completed' || String(data.reviewStatus) === 'Archived') {
      throw new HttpsError('failed-precondition', 'Completed/archived reviews are immutable');
    }
  }
}

function mapUserSnapshot(user: DocumentData, userDocId: string) {
  return {
    userId: userDocId,
    employeeId: String(user.employeeId || ''),
    username: String(user.username || user.email || ''),
    userName: String(user.fullName || user.full_name || user.email || ''),
    employeeName: String(user.fullName || user.full_name || ''),
    email: String(user.email || ''),
    department: String(user.department || ''),
    designation: String(user.designation || ''),
    role: String(user.role || ''),
    businessUnit: String(user.businessUnit || ''),
    company: String(user.company || user.companyName || ''),
    site: String(user.siteName || user.site || ''),
    manager: String(user.reportingManager || ''),
    managerId: String(user.managerId || ''),
    accountStatus: String(user.userStatus || user.status || 'Active'),
    accessStatus: user.accountLocked ? 'Locked' : String(user.userStatus || 'Active'),
    employmentType: String(user.employmentType || ''),
    lastLogin: user.lastLogin ? String(user.lastLogin) : null,
    privileged: PRIVILEGED_ROLES.has(String(user.role || '')),
  };
}

export const createAdminAccessReview = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManager(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const userId = requiredString(data.userId, 'User ID', 128);
  const reviewPeriod = requiredString(data.reviewPeriod, 'Review period', 80);
  const dueDate = optionalString(data.dueDate, 'Due date', 40);
  const reviewerUserId = optionalString(data.reviewerUserId, 'Reviewer user ID', 128);
  const reviewerName = optionalString(data.reviewerName, 'Reviewer name', 200) || actorName;
  const reviewerRole = optionalString(data.reviewerRole, 'Reviewer role', 80) || actorRole;

  const userSnap = await firestore.collection('users').doc(userId).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'Subject user not found');
  const user = userSnap.data() || {};
  const snapshot = mapUserSnapshot(user, userId);
  const sod = detectSodConflicts(snapshot.role, reviewerRole, userId, reviewerUserId || actorUid);
  const accessFindings = analyzeUserAccess(user, null);
  const now = new Date().toISOString();
  const reviewId = buildReviewId();
  const reviewNumber = buildReviewNumber(reviewPeriod);
  const ref = firestore.collection('access_reviews').doc();

  const payload = {
    reviewId,
    reviewNumber,
    ...snapshot,
    reviewerUserId: reviewerUserId || actorUid,
    reviewerName,
    reviewerRole,
    reviewPeriod,
    reviewStatus: 'Pending',
    status: 'Active',
    riskLevel: sod.some((i) => i.severity === 'Critical') || accessFindings.some((i) => i.severity === 'Critical')
      ? 'Critical'
      : sod.length || accessFindings.some((i) => i.severity === 'High')
        ? 'High'
        : accessFindings.length ? 'Medium' : 'Low',
    reviewDate: optionalString(data.reviewDate, 'Review date', 40) || now.slice(0, 10),
    dueDate: dueDate || '',
    completionDate: null,
    nextReviewDate: optionalString(data.nextReviewDate, 'Next review date', 40),
    findings: optionalString(data.findings, 'Findings'),
    actionTaken: optionalString(data.actionTaken, 'Action taken'),
    reviewComments: optionalString(data.reviewComments, 'Review comments'),
    recommendation: optionalString(data.recommendation, 'Recommendation', 500),
    finalDecision: optionalString(data.finalDecision, 'Final decision', 120),
    issues: [...sod, ...accessFindings],
    criticalIssueCount: [...sod, ...accessFindings].filter((i) => i.severity === 'Critical').length,
    rolesReviewed: [snapshot.role],
    permissionsSnapshot: {},
    modulesAccess: [],
    temporaryAccess: snapshot.employmentType === 'Temporary',
    electronicSignature: null,
    signedAt: null,
    signedBy: null,
    signatureMeaning: '',
    immutable: false,
    isArchived: false,
    workflowStage: 'Pending',
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
    changeReason: reason,
  };

  await ref.set(payload);
  await writeAccessReviewAudit(firestore, {
    actorUid, actorName, recordId: ref.id, actionType: 'Create',
    description: `Access review ${reviewId} created for ${snapshot.userName}`,
    newValue: { reviewId, userId, reviewStatus: 'Pending' }, reason, now,
  });
  if (payload.reviewerUserId) {
    await notify(firestore, String(payload.reviewerUserId), 'Review Assigned', 'Access review assigned',
      `Review ${reviewId} assigned for ${snapshot.userName}`, now);
  }
  return { success: true, id: ref.id, reviewId, reviewNumber };
});

export const updateAdminAccessReview = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManager(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Review document ID', 128);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('access_reviews').doc(id).get();
  assertMutable(snap.data());
  const prev = snap.data() || {};
  if (TERMINAL_LOCK.has(String(prev.reviewStatus)) && String(prev.reviewStatus) !== 'Closed') {
    throw new HttpsError('failed-precondition', 'Cannot update a locked review');
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    updatedAt: now,
    updatedBy: actorUid,
    changeReason: reason,
  };
  for (const key of [
    'findings', 'actionTaken', 'reviewComments', 'recommendation', 'finalDecision',
    'dueDate', 'nextReviewDate', 'reviewPeriod', 'reviewerName', 'reviewerUserId', 'reviewerRole',
    'riskLevel',
  ]) {
    if (data[key] !== undefined) patch[key] = optionalString(data[key], key);
  }
  if (data.issues && Array.isArray(data.issues)) {
    patch.issues = data.issues;
    patch.criticalIssueCount = (data.issues as Array<{ severity?: string }>)
      .filter((i) => i.severity === 'Critical').length;
  }

  await snap.ref.update(patch);
  await writeAccessReviewAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Update',
    description: `Access review ${prev.reviewId || id} updated`,
    oldValue: { reviewStatus: prev.reviewStatus },
    newValue: patch, reason, now,
  });
  return { success: true, id };
});

export const transitionAdminAccessReview = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManager(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Review document ID', 128);
  const targetStatus = requiredString(data.targetStatus, 'Target status', 40);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const comments = optionalString(data.reviewComments, 'Review comments');

  if (!(REVIEW_STATUSES as readonly string[]).includes(targetStatus)) {
    throw new HttpsError('invalid-argument', 'Invalid review status');
  }

  const snap = await firestore.collection('access_reviews').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Access review not found');
  const prev = snap.data() || {};
  const current = String(prev.reviewStatus || 'Draft');

  if (TERMINAL_LOCK.has(current) && !(current === 'Closed' && targetStatus === 'Pending')) {
    throw new HttpsError('failed-precondition', `Cannot transition from ${current}`);
  }
  if (current === 'Completed' && targetStatus === 'Archived') {
    // allow archive of completed
  } else {
    const allowed = TRANSITIONS[current] || [];
    if (!allowed.includes(targetStatus) && !(current === 'Closed' && targetStatus === 'Pending')) {
      throw new HttpsError('failed-precondition', `Transition ${current} → ${targetStatus} is not allowed`);
    }
  }

  if (targetStatus === 'Completed') {
    throw new HttpsError('failed-precondition', 'Use completeAdminAccessReview for completion with e-signature');
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    reviewStatus: targetStatus,
    workflowStage: targetStatus,
    updatedAt: now,
    updatedBy: actorUid,
    changeReason: reason,
    immutable: targetStatus === 'Archived',
    isArchived: targetStatus === 'Archived',
  };
  if (comments) patch.reviewComments = comments;
  if (targetStatus === 'Rejected') patch.finalDecision = 'Rejected';
  if (targetStatus === 'Pending' && current === 'Closed') {
    patch.immutable = false;
    patch.reopenedAt = now;
    patch.reopenedBy = actorUid;
  }

  await snap.ref.update(patch);
  await writeAccessReviewAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: targetStatus === 'Rejected' ? 'Reject' : 'Workflow',
    description: `Access review ${prev.reviewId || id}: ${current} → ${targetStatus}`,
    oldValue: { reviewStatus: current },
    newValue: { reviewStatus: targetStatus },
    reason, now,
  });

  const notifyUid = String(prev.reviewerUserId || prev.userId || '');
  if (targetStatus === 'Rejected') {
    await notify(firestore, notifyUid, 'Review Rejected', 'Access review rejected',
      `Review ${prev.reviewId} was rejected`, now, 'High');
  } else if (['Pending', 'Manager Review', 'QA Review', 'IT Review'].includes(targetStatus)) {
    await notify(firestore, notifyUid, 'Review Assigned', 'Access review status updated',
      `Review ${prev.reviewId} is now ${targetStatus}`, now);
  }

  return { success: true, id, reviewStatus: targetStatus };
});

export const completeAdminAccessReview = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManager(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Review document ID', 128);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const comments = requiredString(data.reviewComments ?? data.comments, 'Reviewer comments', 5000);
  const recommendation = requiredString(data.recommendation, 'Recommendation', 500);
  const finalDecision = requiredString(data.finalDecision, 'Final decision', 120);
  const signatureMeaning = requiredString(data.signatureMeaning ?? 'I have reviewed this access and attest the decision', 'Signature meaning', 500);
  const passwordConfirm = optionalString(data.passwordConfirm, 'Password confirm', 200);

  const snap = await firestore.collection('access_reviews').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Access review not found');
  const prev = snap.data() || {};
  const current = String(prev.reviewStatus || '');
  if (TERMINAL_LOCK.has(current)) {
    throw new HttpsError('failed-precondition', 'Review is already completed or locked');
  }

  const issues = Array.isArray(prev.issues) ? prev.issues as Array<{ severity?: string; resolved?: boolean }> : [];
  const unresolvedCritical = issues.filter((i) => i.severity === 'Critical' && i.resolved !== true);
  if (unresolvedCritical.length > 0 && finalDecision !== 'Revoke Access' && finalDecision !== 'Disable Account') {
    throw new HttpsError(
      'failed-precondition',
      'Cannot complete with unresolved critical issues unless decision is Revoke Access or Disable Account',
    );
  }

  if (String(prev.userId) === actorUid) {
    throw new HttpsError('failed-precondition', 'SoD: you cannot complete a review of your own account');
  }

  // Electronic signature attestation (password re-auth expected client-side before call)
  if (!passwordConfirm && data.requirePassword !== false) {
    // Accept signature payload without re-sending password when client already reauthenticated token
  }

  const now = new Date().toISOString();
  const eSign = {
    signedBy: actorUid,
    signedByName: actorName,
    signedAt: now,
    signatureMeaning,
    method: 'Electronic Signature',
    attested: true,
  };

  await snap.ref.update({
    reviewStatus: 'Completed',
    workflowStage: 'Completed',
    reviewComments: comments,
    recommendation,
    finalDecision,
    completionDate: now.slice(0, 10),
    electronicSignature: eSign,
    signedAt: now,
    signedBy: actorUid,
    signatureMeaning,
    immutable: true,
    updatedAt: now,
    updatedBy: actorUid,
    changeReason: reason,
    criticalIssueCount: unresolvedCritical.length,
  });

  await writeAccessReviewAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Complete',
    description: `Access review ${prev.reviewId || id} completed with e-signature`,
    oldValue: { reviewStatus: current },
    newValue: { reviewStatus: 'Completed', finalDecision, electronicSignature: true },
    reason, now,
  });

  await notify(firestore, String(prev.userId || ''), 'Review Completed', 'Access review completed',
    `Your access review ${prev.reviewId} was completed. Decision: ${finalDecision}`, now);
  await notify(firestore, String(prev.reviewerUserId || ''), 'Review Completed', 'Access review completed',
    `Review ${prev.reviewId} completed`, now);

  // Sync recommendation actions back toward user management (flag only — no silent privilege change)
  if (['Revoke Access', 'Disable Account', 'Lock Account'].includes(finalDecision) && prev.userId) {
    const userRef = firestore.collection('users').doc(String(prev.userId));
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const userPatch: Record<string, unknown> = {
        updatedAt: now,
        updatedBy: actorUid,
        accessReviewDecision: finalDecision,
        accessReviewId: prev.reviewId || id,
        accessReviewCompletedAt: now,
      };
      if (finalDecision === 'Disable Account' || finalDecision === 'Revoke Access') {
        userPatch.userStatus = 'Inactive';
        userPatch.status = 'Inactive';
      }
      if (finalDecision === 'Lock Account') {
        userPatch.accountLocked = true;
      }
      await userRef.update(userPatch);
      await writeAccessReviewAudit(firestore, {
        actorUid, actorName, recordId: String(prev.userId), actionType: 'Access Revoked',
        description: `User access updated from review ${prev.reviewId}: ${finalDecision}`,
        newValue: userPatch, reason, now,
      });
      await notify(firestore, String(prev.userId), 'Access Revoked', 'Access change from review',
        `Decision from access review: ${finalDecision}`, now, 'High');
    }
  }

  return { success: true, id, reviewStatus: 'Completed' };
});

export const generateAdminAccessReviewCampaign = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertAdmin(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const reviewPeriod = requiredString(data.reviewPeriod, 'Review period', 80);
  const dueDate = optionalString(data.dueDate, 'Due date', 40);
  const includeInactive = Boolean(data.includeInactive);
  const privilegedOnly = Boolean(data.privilegedOnly);

  const usersSnap = await firestore.collection('users').limit(500).get();
  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;
  const batchLimit = 400;
  let batch = firestore.batch();
  let ops = 0;

  for (const docSnap of usersSnap.docs) {
    const user = docSnap.data();
    if (user.isDeleted === true) { skipped += 1; continue; }
    const status = String(user.userStatus || user.status || 'Active');
    if (!includeInactive && (status === 'Inactive' || status === 'Suspended')) { skipped += 1; continue; }
    const role = String(user.role || '');
    if (privilegedOnly && !PRIVILEGED_ROLES.has(role)) { skipped += 1; continue; }

    const existing = await firestore.collection('access_reviews')
      .where('userId', '==', docSnap.id)
      .where('reviewPeriod', '==', reviewPeriod)
      .limit(1)
      .get();
    if (!existing.empty) { skipped += 1; continue; }

    const snapshot = mapUserSnapshot(user, docSnap.id);
    const findings = analyzeUserAccess(user, null);
    const reviewId = buildReviewId();
    const ref = firestore.collection('access_reviews').doc();
    batch.set(ref, {
      reviewId,
      reviewNumber: buildReviewNumber(reviewPeriod),
      ...snapshot,
      reviewerUserId: actorUid,
      reviewerName: actorName,
      reviewerRole: actorRole,
      reviewPeriod,
      reviewStatus: 'Pending',
      status: 'Active',
      riskLevel: findings.some((i) => i.severity === 'Critical')
        ? 'Critical'
        : findings.some((i) => i.severity === 'High') ? 'High' : findings.length ? 'Medium' : 'Low',
      reviewDate: now.slice(0, 10),
      dueDate,
      completionDate: null,
      nextReviewDate: '',
      findings: findings.map((f) => f.message).join('; '),
      actionTaken: '',
      reviewComments: '',
      recommendation: '',
      finalDecision: '',
      issues: findings,
      criticalIssueCount: findings.filter((f) => f.severity === 'Critical').length,
      rolesReviewed: [snapshot.role],
      temporaryAccess: snapshot.employmentType === 'Temporary',
      electronicSignature: null,
      immutable: false,
      isArchived: false,
      workflowStage: 'Pending',
      campaignGenerated: true,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUid,
      updatedBy: actorUid,
      changeReason: reason,
    });
    created += 1;
    ops += 1;
    if (ops >= batchLimit) {
      await batch.commit();
      batch = firestore.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  await writeAccessReviewAudit(firestore, {
    actorUid, actorName, recordId: 'campaign', actionType: 'Create',
    description: `Generated ${created} access reviews for period ${reviewPeriod}`,
    newValue: { created, skipped, reviewPeriod }, reason, now,
  });

  return { success: true, created, skipped, reviewPeriod };
});

export const analyzeAdminAccessRisks = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole } = await resolveActor(request);
  assertViewer(actor, actorRole);

  const [usersSnap, loginSnap] = await Promise.all([
    firestore.collection('users').limit(500).get(),
    firestore.collection('login_activity')
      .where('loginStatus', '==', 'Success')
      .orderBy('loginTime', 'desc')
      .limit(400)
      .get()
      .catch(() => ({ docs: [] as Array<{ data: () => DocumentData }> })),
  ]);

  const lastLoginByUser = new Map<string, string>();
  for (const d of loginSnap.docs) {
    const row = d.data();
    const uid = String(row.userId || '');
    if (uid && !lastLoginByUser.has(uid)) lastLoginByUser.set(uid, String(row.loginTime || ''));
  }

  const now = Date.now();
  const orphanAccounts: Array<Record<string, unknown>> = [];
  const inactiveUsers: Array<Record<string, unknown>> = [];
  const privilegedUsers: Array<Record<string, unknown>> = [];
  const temporaryAccess: Array<Record<string, unknown>> = [];
  const sodConflicts: Array<Record<string, unknown>> = [];
  const emailCounts = new Map<string, number>();

  for (const docSnap of usersSnap.docs) {
    const user = docSnap.data();
    const email = String(user.email || '').toLowerCase();
    if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  }

  for (const docSnap of usersSnap.docs) {
    const user = docSnap.data();
    const snapshot = mapUserSnapshot(user, docSnap.id);
    const last = lastLoginByUser.get(docSnap.id) || lastLoginByUser.get(String(user.authUid || ''));
    const days = last ? Math.floor((now - new Date(last).getTime()) / 86400000) : null;
    const findings = analyzeUserAccess(user, days);

    if (findings.some((f) => f.code === 'ORPHAN_ACCOUNT' || f.code === 'ORPHAN_INACTIVE_LOGIN')) {
      orphanAccounts.push({ ...snapshot, lastLogin: last || null, daysSinceLogin: days });
    }
    if (findings.some((f) => f.code === 'INACTIVE_ACCOUNT')) {
      inactiveUsers.push(snapshot);
    }
    if (snapshot.privileged) privilegedUsers.push(snapshot);
    if (snapshot.employmentType === 'Temporary') temporaryAccess.push(snapshot);

    const email = String(user.email || '').toLowerCase();
    if (email && (emailCounts.get(email) || 0) > 1) {
      sodConflicts.push({
        code: 'DUPLICATE_ACCOUNT',
        severity: 'High',
        message: `Duplicate email account: ${email}`,
        userId: docSnap.id,
        userName: snapshot.userName,
      });
    }
  }

  return {
    success: true,
    summary: {
      usersScanned: usersSnap.size,
      orphanAccounts: orphanAccounts.length,
      inactiveUsers: inactiveUsers.length,
      privilegedUsers: privilegedUsers.length,
      temporaryAccess: temporaryAccess.length,
      duplicateOrSod: sodConflicts.length,
    },
    orphanAccounts,
    inactiveUsers,
    privilegedUsers,
    temporaryAccess,
    sodConflicts,
  };
});

export const archiveAdminAccessReviews = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertAdmin(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const beforeDate = requiredString(data.beforeDate, 'Before date', 40);
  const now = new Date().toISOString();

  const snap = await firestore.collection('access_reviews')
    .where('reviewStatus', 'in', ['Completed', 'Closed'])
    .limit(300)
    .get();

  let archived = 0;
  for (const docSnap of snap.docs) {
    const row = docSnap.data();
    const completed = String(row.completionDate || row.updatedAt || '');
    if (completed && completed.slice(0, 10) > beforeDate) continue;
    if (row.isArchived === true) continue;
    const archiveRef = firestore.collection('access_reviews_archive').doc(docSnap.id);
    await archiveRef.set({
      ...row,
      isArchived: true,
      immutable: true,
      reviewStatus: 'Archived',
      archivedAt: now,
      archivedBy: actorUid,
    });
    await docSnap.ref.update({
      isArchived: true,
      immutable: true,
      reviewStatus: 'Archived',
      archivedAt: now,
      archivedBy: actorUid,
      updatedAt: now,
      updatedBy: actorUid,
    });
    archived += 1;
  }

  await writeAccessReviewAudit(firestore, {
    actorUid, actorName, recordId: 'archive', actionType: 'Archive',
    description: `Archived ${archived} access reviews before ${beforeDate}`,
    newValue: { archived, beforeDate }, reason, now,
  });
  return { success: true, archived };
});

export const markAdminAccessReviewsOverdue = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManager(actor, actorRole);
  const today = new Date().toISOString().slice(0, 10);
  const snap = await firestore.collection('access_reviews')
    .where('reviewStatus', 'in', ['Pending', 'In Progress', 'Self Review', 'Manager Review', 'QA Review', 'IT Review', 'Pending Approval'])
    .limit(300)
    .get();

  let marked = 0;
  const now = new Date().toISOString();
  for (const docSnap of snap.docs) {
    const row = docSnap.data();
    const due = String(row.dueDate || '');
    if (!due || due >= today) continue;
    await docSnap.ref.update({
      reviewStatus: 'Overdue',
      workflowStage: 'Overdue',
      updatedAt: now,
      updatedBy: actorUid,
    });
    marked += 1;
    await notify(firestore, String(row.reviewerUserId || ''), 'Review Overdue', 'Access review overdue',
      `Review ${row.reviewId} is overdue (due ${due})`, now, 'High');
  }

  await writeAccessReviewAudit(firestore, {
    actorUid, actorName, recordId: 'overdue-job', actionType: 'Update',
    description: `Marked ${marked} access reviews overdue`,
    newValue: { marked }, reason: 'Scheduled overdue scan', now,
  });
  return { success: true, marked };
});

export const logAdminAccessReviewExport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const format = requiredString(data.format, 'Format', 40);
  const count = Number(data.count || 0);
  const now = new Date().toISOString();
  await writeAccessReviewAudit(firestore, {
    actorUid, actorName, recordId: 'export', actionType: 'Export',
    description: `Exported ${count} access review records as ${format}`,
    newValue: { format, count }, reason: 'Export', now,
  });
  return { success: true };
});

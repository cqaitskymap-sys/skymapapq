/**
 * CPV Dashboard — privileged Cloud Functions.
 * Server-side audit for dashboard view/export + optional aggregate snapshot.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData } from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';
import { BROWSER_CALLABLE } from './callable-options';


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

const VIEWER_ROLES = [
  'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
  'qc', 'qc_manager', 'production', 'production_manager',
  'engineering', 'engineering_manager', 'viewer', 'auditor',
];

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Not authorized for CPV Dashboard');
  }
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
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

async function writeCpvDashAudit(
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    actionType: string;
    description: string;
    reason?: string;
    now: string;
  },
) {
  const batch = firestore.batch();
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-CPVD-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'CPV',
    subModule: 'CPV Dashboard',
    collectionName: 'cpv_dashboard',
    recordId: 'dashboard',
    documentId: 'dashboard',
    actionType: input.actionType,
    action: input.actionType,
    actionDescription: input.description,
    reason: input.reason || '',
    performedBy: input.actorName,
    userId: input.actorUid,
    userName: input.actorName,
    createdAt: input.now,
    source: 'cpv-dashboard-admin',
    immutable: true,
    appendOnly: true,
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: 'CPV Dashboard',
    action: input.actionType,
    recordId: 'dashboard',
    description: input.description,
    performedBy: input.actorName,
    userId: input.actorUid,
    reason: input.reason || '',
    timestamp: input.now,
    createdAt: input.now,
    status: 'Success',
  });
  batch.set(firestore.collection('cpv_audit_trail').doc(), {
    moduleName: 'CPV Dashboard',
    actionType: input.actionType,
    actionDescription: input.description,
    recordId: 'dashboard',
    userId: input.actorUid,
    userName: input.actorName,
    timestamp: input.now,
    createdAt: input.now,
    status: 'Success',
  });
  await batch.commit();
}

async function countCollection(firestore: Firestore, name: string, max = 500): Promise<number> {
  try {
    const snap = await firestore.collection(name).limit(max).get();
    return snap.size;
  } catch {
    return 0;
  }
}

async function countFirst(firestore: Firestore, names: string[], max = 500): Promise<number> {
  for (const name of names) {
    const count = await countCollection(firestore, name, max);
    if (count > 0) return count;
  }
  return 0;
}

/** Lightweight server snapshot counts for executive health (optional enrichment). */
export const getAdminCpvDashboardSnapshot = onCall({ timeoutSeconds: 60, ...BROWSER_CALLABLE }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const now = new Date().toISOString();

  const [
    cppResults,
    cqaResults,
    risks,
    reviews,
    capability,
    controlCharts,
    batches,
  ] = await Promise.all([
    countFirst(firestore, ['cpp_results', 'cpv_cpp']),
    countFirst(firestore, ['cqa_results', 'cpv_cqa']),
    countFirst(firestore, ['risk_assessment', 'cpv_risk_assessment']),
    countFirst(firestore, ['cpv_reviews', 'cpv_annual_review']),
    countFirst(firestore, ['process_capability', 'cpv_capability']),
    countFirst(firestore, ['control_charts', 'cpv_control_charts']),
    countFirst(firestore, ['cpv_batches', 'batches']),
  ]);

  const snapshot = {
    snapshotId: `CPVD-${Date.now().toString(36).toUpperCase()}`,
    checkedAt: now,
    counts: {
      cppResults,
      cqaResults,
      risks,
      reviews,
      capability,
      controlCharts,
      batches,
    },
    source: 'getAdminCpvDashboardSnapshot',
  };

  await writeCpvDashAudit(firestore, {
    actorUid,
    actorName,
    actionType: 'Dashboard Snapshot',
    description: `CPV dashboard server snapshot (cpp=${cppResults}, cqa=${cqaResults}, risks=${risks})`,
    reason: 'Server aggregate snapshot',
    now,
  });

  return snapshot;
});

async function handleCpvDashboardAudit(request: { auth?: { uid: string } | null; data: unknown }) {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const actionType = requiredString(data.actionType || 'View', 'Action type', 80);
  const description = requiredString(
    data.description || `CPV Dashboard ${actionType}`,
    'Description',
    500,
  );
  const now = new Date().toISOString();
  await writeCpvDashAudit(firestore, {
    actorUid,
    actorName,
    actionType,
    description,
    reason: typeof data.changeReason === 'string' ? data.changeReason : actionType,
    now,
  });
  return { success: true };
}

/** Legacy name — Cloud Run IAM on this endpoint is private (v2 callable updates do not re-grant public invoke). */
export const logAdminCpvDashboardAudit = onCall(BROWSER_CALLABLE, handleCpvDashboardAudit);

/** New callable so first-time deploy can grant public invoke (required for browser CORS preflight). */
export const recordAdminCpvDashboardAudit = onCall(BROWSER_CALLABLE, handleCpvDashboardAudit);

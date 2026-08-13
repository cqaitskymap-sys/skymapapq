import { normalizeFirebaseEnvValue } from '@/lib/firebase-config';

export type VerifiedFirebaseUser = {
  uid: string;
  email?: string;
};

function firestoreFieldString(fields: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = fields?.[key] as { stringValue?: string } | undefined;
  return value?.stringValue;
}

function firestoreFieldBoolean(fields: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = fields?.[key] as { booleanValue?: boolean } | undefined;
  return value?.booleanValue;
}

function isFirebaseEmulatorEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';
}

function identityToolkitLookupUrl(apiKey: string): string {
  if (isFirebaseEmulatorEnabled()) {
    return `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;
  }
  return `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;
}

function firestoreProfileUrl(projectId: string, uid: string): string {
  const path = `projects/${projectId}/databases/(default)/documents/profiles/${uid}`;
  if (isFirebaseEmulatorEnabled()) {
    return `http://127.0.0.1:8080/v1/${path}`;
  }
  return `https://firestore.googleapis.com/v1/${path}`;
}

/**
 * Verify a Firebase ID token via Identity Toolkit lookup, then require an active profile.
 * Expects `Authorization: Bearer <idToken>`.
 */
export async function verifyFirebaseBearerToken(request: Request): Promise<boolean> {
  const user = await verifyActiveFirebaseUser(request);
  return user !== null;
}

/**
 * Returns the authenticated active user, or null if the token/profile is invalid.
 */
export async function verifyActiveFirebaseUser(request: Request): Promise<VerifiedFirebaseUser | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  const apiKey = normalizeFirebaseEnvValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const projectId = normalizeFirebaseEnvValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  if (!apiKey || !projectId) return null;

  try {
    const lookupRes = await fetch(identityToolkitLookupUrl(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!lookupRes.ok) return null;

    const lookupData = (await lookupRes.json()) as {
      users?: Array<{ localId?: string; email?: string; disabled?: boolean }>;
    };
    const authUser = lookupData.users?.[0];
    const uid = authUser?.localId?.trim();
    if (!authUser || !uid || authUser.disabled) return null;

    const profileRes = await fetch(firestoreProfileUrl(projectId, uid), {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!profileRes.ok) return null;

    const profileData = (await profileRes.json()) as { fields?: Record<string, unknown> };
    const isActive = firestoreFieldBoolean(profileData.fields, 'is_active') === true;
    const accessStatus = firestoreFieldString(profileData.fields, 'access_status');
    const blockedStatuses = ['pending', 'disabled', 'locked', 'retired', 'rejected'];
    if (!isActive || blockedStatuses.includes(accessStatus || '')) return null;

    return { uid, email: authUser.email };
  } catch {
    return null;
  }
}

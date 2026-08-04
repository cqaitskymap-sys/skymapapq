import { normalizeFirebaseEnvValue } from '@/lib/firebase-config';

/**
 * Verify a Firebase ID token via Identity Toolkit lookup.
 * Expects `Authorization: Bearer <idToken>`.
 */
export async function verifyFirebaseBearerToken(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return false;

  const apiKey = normalizeFirebaseEnvValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!apiKey) return false;

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

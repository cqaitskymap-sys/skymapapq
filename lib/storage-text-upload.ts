import { getFirebaseAuth, isFirebaseConfigured } from './firebase';

/**
 * Upload text content to Firebase Storage via a server API route.
 * Avoids browser CORS failures when the GCS bucket CORS config is missing.
 */
export async function uploadTextToStorage(
  path: string,
  content: string,
  contentType: string,
): Promise<void> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured.');
  }

  const user = getFirebaseAuth().currentUser;
  if (!user) {
    throw new Error('You must be signed in to upload files.');
  }

  const token = await user.getIdToken(true);
  const res = await fetch('/api/storage/upload-text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path, content, contentType }),
  });

  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.error === 'string' ? body.error : 'Upload failed.');
    }
    throw new Error(
      res.status === 404
        ? 'Upload API not found. Restart the dev server (npm run dev).'
        : `Upload request failed (${res.status}).`,
    );
  }
}

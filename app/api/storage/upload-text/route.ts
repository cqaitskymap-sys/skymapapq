import { NextResponse } from 'next/server';
import { getFirebaseStorageBucket, normalizeFirebaseEnvValue } from '@/lib/firebase-config';

const ALLOWED_PATH = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/;
const ALLOWED_MODULES = new Set(['cpv-reports', 'cpv-reviews']);
const ALLOWED_CONTENT_TYPES = new Set(['text/html', 'text/csv', 'application/pdf', 'text/plain']);

function storageBucketCandidates(): string[] {
  const bucket = getFirebaseStorageBucket();
  if (!bucket) return [];

  const candidates = [bucket];
  if (bucket.endsWith('.firebasestorage.app')) {
    candidates.push(`${bucket.replace(/\.firebasestorage\.app$/, '')}.appspot.com`);
  } else if (bucket.endsWith('.appspot.com')) {
    candidates.push(`${bucket.replace(/\.appspot\.com$/, '')}.firebasestorage.app`);
  }
  return Array.from(new Set(candidates));
}

async function verifyIdToken(idToken: string): Promise<boolean> {
  const apiKey = normalizeFirebaseEnvValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!apiKey) return false;

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  );
  return res.ok;
}

async function uploadWithResumableProtocol(
  bucket: string,
  path: string,
  content: string,
  contentType: string,
  idToken: string,
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  const encodedName = encodeURIComponent(path);
  const startUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodedName}`;
  const contentLength = Buffer.byteLength(content, 'utf8');

  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: {
      Authorization: `Firebase ${idToken}`,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(contentLength),
      'X-Goog-Upload-Header-Content-Type': contentType,
    },
  });

  if (!startRes.ok) {
    const detail = await startRes.text().catch(() => '');
    return { ok: false, status: startRes.status, detail };
  }

  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    return { ok: false, status: 502, detail: 'Storage did not return an upload URL.' };
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Firebase ${idToken}`,
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Type': contentType,
    },
    body: content,
  });

  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => '');
    return { ok: false, status: uploadRes.status, detail };
  }

  return { ok: true };
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const idToken = authHeader.slice(7);

  if (!(await verifyIdToken(idToken))) {
    return NextResponse.json(
      { error: 'Invalid or expired session. Sign in again.' },
      { status: 401 },
    );
  }

  let body: { path?: string; content?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { path, content, contentType } = body;
  if (!path || content === undefined || !contentType) {
    return NextResponse.json(
      { error: 'path, content, and contentType are required' },
      { status: 400 },
    );
  }

  if (!ALLOWED_PATH.test(path)) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 });
  }

  const moduleName = path.split('/')[0];
  if (!moduleName || !ALLOWED_MODULES.has(moduleName)) {
    return NextResponse.json({ error: 'Storage path not allowed' }, { status: 403 });
  }

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'Content type not allowed' }, { status: 400 });
  }

  const buckets = storageBucketCandidates();
  if (buckets.length === 0) {
    return NextResponse.json({ error: 'Storage bucket not configured' }, { status: 503 });
  }

  let lastFailure: { status: number; detail: string } | null = null;

  for (const bucket of buckets) {
    const result = await uploadWithResumableProtocol(bucket, path, content, contentType, idToken);
    if (result.ok) {
      return NextResponse.json({ path, bucket });
    }
    lastFailure = { status: result.status, detail: result.detail };
    console.error(`Storage upload failed for bucket ${bucket}:`, result.status, result.detail);
    if (result.status !== 404) break;
  }

  const status = lastFailure?.status ?? 500;
  const message = status === 403
    ? 'Upload denied by storage rules. Ask an admin to run: npm run deploy:storage'
    : status === 404
      ? 'Firebase Storage bucket not found. Confirm Storage is enabled and NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET matches Firebase Console.'
      : `Storage upload failed (${status})`;

  return NextResponse.json({ error: message }, { status });
}

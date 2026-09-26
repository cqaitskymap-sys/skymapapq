import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only our project's callables — blocks open-proxy / path traversal. */
const CALLABLE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;

const FUNCTIONS_REGION = (process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || 'us-central1').trim();
const PROJECT_ID = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();

function functionUrl(name: string): string {
  return `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await context.params;
    if (!CALLABLE_NAME.test(name) || !PROJECT_ID) {
      return NextResponse.json({ error: { status: 'NOT_FOUND', message: 'Unknown function' } }, { status: 404 });
    }

    const body = await request.text();
    const headers: Record<string, string> = {
      'Content-Type': request.headers.get('content-type') || 'application/json',
    };
    const authorization = request.headers.get('authorization');
    if (authorization) headers.Authorization = authorization;
    const appCheck = request.headers.get('x-firebase-appcheck');
    if (appCheck) headers['X-Firebase-AppCheck'] = appCheck;

    const upstream = await fetch(functionUrl(name), {
      method: 'POST',
      headers,
      body,
    });
    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      const gatewayDown = upstream.status >= 500
        || /server error|not available yet|denied: please check billing/i.test(text);
      const status = upstream.status === 404
        ? 'NOT_FOUND'
        : gatewayDown
          ? 'UNAVAILABLE'
          : 'INTERNAL';
      const message = upstream.status === 404
        ? `Cloud Function ${name} is not deployed in ${PROJECT_ID} (${FUNCTIONS_REGION}). Deploy functions, then retry.`
        : gatewayDown
          ? `Cloud Function ${name} is not serving (HTTP ${upstream.status}). Privileged writes require a billed Firebase/Blaze project. Enable billing for ${PROJECT_ID}, wait a few minutes, then retry.`
          : `Callable ${name} returned ${upstream.status}`;
      return NextResponse.json(
        { error: { status, message } },
        { status: gatewayDown ? 503 : (upstream.status >= 400 ? upstream.status : 502) },
      );
    }
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': contentType },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upstream callable failed';
    return NextResponse.json(
      { error: { status: 'INTERNAL', message } },
      { status: 502 },
    );
  }
}

import { NextResponse } from 'next/server';

/**
 * Fail-closed cron auth: secret must be set, and Authorization must match.
 * Returns a NextResponse on failure, or null when authorized.
 */
export function assertCronAuthorized(
  request: Request,
  secretEnvName: string,
): NextResponse | null {
  const secret = process.env[secretEnvName]?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: `${secretEnvName} is not configured` },
      { status: 503 },
    );
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

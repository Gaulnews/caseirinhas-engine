import { NextRequest, NextResponse } from 'next/server';
import { dispatchDueJobs } from '../../../../../lib/server/queue';

export const dynamic = 'force-dynamic';

function requireDispatchSecret(request: NextRequest): boolean {
  const expected = process.env.QUEUE_DISPATCH_SECRET;
  if (!expected) return false;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

/**
 * Meant to be called by an external scheduler (e.g. a Vercel Cron Job) on a fixed interval —
 * never from the browser or the admin panel. Authenticated with its own secret, separate from
 * ADMIN_API_TOKEN, so rotating one never affects the other.
 */
export async function POST(request: NextRequest) {
  if (!requireDispatchSecret(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const requestedLimit = Number(searchParams.get('limit') ?? '20');
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;

  const summary = await dispatchDueJobs(limit).catch((error: unknown) => {
    return { error: error instanceof Error ? error.message : 'dispatch_failed' };
  });
  if ('error' in summary) return NextResponse.json(summary, { status: 502 });

  return NextResponse.json({ success: true, ...summary });
}

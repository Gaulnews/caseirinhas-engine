import { NextRequest, NextResponse } from 'next/server';
import { runDispatch } from '../../../lib/server/dispatcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function verifyCronAuth(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Allow unauthenticated in local development when CRON_SECRET is not set
  if (!secret) return process.env.NODE_ENV === 'development';
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const objective = parseInt(searchParams.get('objective') ?? '', 10);

  if (!Number.isFinite(objective) || objective < 1 || objective > 10) {
    return NextResponse.json(
      { error: 'objective must be an integer between 1 and 10' },
      { status: 400 },
    );
  }

  try {
    const summary = await runDispatch(objective);
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown dispatch error';
    console.error(`[cron:${objective}]`, message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

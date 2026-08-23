import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'caseirinhas-bot',
    timestamp: new Date().toISOString(),
    dryRun: process.env.WAB_DRY_RUN === 'true',
    provider: process.env.MESSAGE_PROVIDER_URL
      ? new URL(process.env.MESSAGE_PROVIDER_URL).hostname
      : 'not-configured',
  });
}

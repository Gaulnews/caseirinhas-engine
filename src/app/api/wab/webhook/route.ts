import { NextRequest, NextResponse } from 'next/server';
import { handleMessage } from '../../../lib/server/bot/engine';

export const dynamic = 'force-dynamic';

function verifyToken(req: NextRequest): boolean {
  const secret = process.env.MESSAGE_PROVIDER_WEBHOOK_SECRET;
  // In development without a secret configured, allow all requests
  if (!secret) return process.env.NODE_ENV !== 'production';

  // Check header first (preferred — no encoding issues)
  const fromHeader =
    req.headers.get('x-webhook-secret') ??
    req.headers.get('x-evolution-signature') ??
    req.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (fromHeader === secret) return true;

  // Fallback: query string (Evolution Manager UI sets this)
  const fromQuery = req.nextUrl.searchParams.get('token');
  if (fromQuery === secret) return true;

  return false;
}

function extractPhone(jid: string): string | null {
  if (!jid.endsWith('@s.whatsapp.net')) return null;
  const digits = jid.split('@')[0];
  return /^\d{10,15}$/.test(digits) ? `+${digits}` : null;
}

export async function GET() {
  return NextResponse.json({
    service: 'caseirinhas-bot',
    status: 'ok',
    dryRun: process.env.WAB_DRY_RUN === 'true',
    provider: process.env.MESSAGE_PROVIDER_URL
      ? new URL(process.env.MESSAGE_PROVIDER_URL).hostname
      : 'not-configured',
  });
}

export async function POST(req: NextRequest) {
  if (!verifyToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const event = payload.event as string | undefined;
  if (event !== 'messages.upsert') return NextResponse.json({ ok: true });

  const instance = String(
    payload.instance ?? process.env.MESSAGE_PROVIDER_INSTANCE ?? ''
  );
  const data = payload.data as Record<string, unknown> | undefined;
  const key = data?.key as Record<string, unknown> | undefined;

  // Ignore own messages and group/broadcast JIDs
  if (key?.fromMe) return NextResponse.json({ ok: true });
  const jid = String(key?.remoteJid ?? '');
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) {
    return NextResponse.json({ ok: true });
  }

  const phone = extractPhone(jid);
  if (!phone) return NextResponse.json({ ok: true });

  const msgData = data?.message as Record<string, unknown> | undefined;
  const extMsg = msgData?.extendedTextMessage as Record<string, unknown> | undefined;
  const text = String(msgData?.conversation ?? extMsg?.text ?? '').trim();
  if (!text) return NextResponse.json({ ok: true });

  const messageId = String(key?.id ?? crypto.randomUUID());
  const pushName = String(data?.pushName ?? 'Cliente');

  await handleMessage(instance, phone, pushName, messageId, text).catch((err) => {
    console.error('[bot] handleMessage error:', err);
  });

  return NextResponse.json({ ok: true });
}

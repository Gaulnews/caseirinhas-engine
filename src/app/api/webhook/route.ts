import { NextRequest, NextResponse } from 'next/server';
import { supabaseRest } from '../../../lib/server/supabase-rest';

export const dynamic = 'force-dynamic';

const OPT_OUT_KEYWORDS = new Set([
  'sair', 'stop', 'parar', 'cancelar',
  'nao quero', 'não quero', 'remover',
  'descadastrar', 'cancelamento',
  'nao me mande', 'não me mande',
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function isOptOut(text: string): boolean {
  const n = normalizeText(text);
  if (OPT_OUT_KEYWORDS.has(n)) return true;
  return Array.from(OPT_OUT_KEYWORDS).some((kw) => n.startsWith(kw + ' '));
}

function extractE164FromJid(jid: string): string | null {
  if (!jid.includes('@s.whatsapp.net')) return null;
  const digits = jid.split('@')[0];
  return digits && /^\d{10,15}$/.test(digits) ? `+${digits}` : null;
}

function verifySignature(request: NextRequest): boolean {
  const secret = process.env.MESSAGE_PROVIDER_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV === 'development';
  const header =
    request.headers.get('x-evolution-signature') ??
    request.headers.get('x-webhook-secret') ??
    request.headers.get('authorization');
  return header === secret || header === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!verifySignature(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const event = payload.event as string | undefined;
  const receivedAt = new Date().toISOString();

  // ── Incoming message ───────────────────────────────────────────────────────
  if (event === 'messages.upsert') {
    const data = payload.data as Record<string, unknown> | undefined;
    const key = data?.key as Record<string, unknown> | undefined;

    if (key?.fromMe) return NextResponse.json({ ok: true });

    const jid = String(key?.remoteJid ?? '');
    const phone = extractE164FromJid(jid);
    if (!phone) return NextResponse.json({ ok: true });

    const msgData = data?.message as Record<string, unknown> | undefined;
    const extMsg = msgData?.extendedTextMessage as Record<string, unknown> | undefined;
    const text = String(msgData?.conversation ?? extMsg?.text ?? '').trim();
    if (!text) return NextResponse.json({ ok: true });

    const providerId = String(key?.id ?? crypto.randomUUID());
    const ts = Number(data?.messageTimestamp);
    const messageReceivedAt = ts > 0 ? new Date(ts * 1000).toISOString() : receivedAt;

    await supabaseRest('inbound_messages?on_conflict=provider_message_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify([{
        provider_message_id: providerId,
        phone_e164: phone,
        message_text: text.slice(0, 4096),
        received_at: messageReceivedAt,
        raw_payload: payload,
      }]),
    });

    if (isOptOut(text)) {
      await Promise.all([
        supabaseRest('opt_outs?on_conflict=phone_e164', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([{
            phone_e164: phone,
            channel: 'whatsapp',
            reason: `keyword: ${text.slice(0, 100)}`,
            source: 'inbound_message',
          }]),
        }),
        supabaseRest(`leads?phone_e164=eq.${encodeURIComponent(phone)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'opted_out', opted_out_at: receivedAt }),
        }),
      ]);
    }
  }

  // ── Delivery / read receipts ────────────────────────────────────────────────
  if (event === 'messages.update') {
    const updates = Array.isArray(payload.data)
      ? (payload.data as Array<Record<string, unknown>>)
      : [];

    const outcomeMap: Record<string, string> = {
      SERVER_ACK: 'sent',
      DELIVERY_ACK: 'delivered',
      READ: 'delivered',
      PLAYED: 'delivered',
      ERROR: 'failed',
    };

    for (const update of updates) {
      const key = update?.key as Record<string, unknown> | undefined;
      const upd = update?.update as Record<string, unknown> | undefined;
      const providerId = String(key?.id ?? '');
      const outcome = outcomeMap[String(upd?.status ?? '')];
      if (!providerId || !outcome) continue;

      await supabaseRest(
        `message_attempts?provider_message_id=eq.${encodeURIComponent(providerId)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ outcome }),
        },
      );
    }
  }

  return NextResponse.json({ ok: true });
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseRest } from '../../../../lib/server/supabase-rest';
import { applyOptOut, detectOptOutKeyword, isValidE164 } from '../../../../lib/server/opt-out';

export const dynamic = 'force-dynamic';

/**
 * Meta's webhook subscription handshake (WhatsApp Cloud API "Webhooks setup"): when the webhook
 * URL is registered/changed in the Meta App Dashboard, Meta sends a GET with hub.mode=subscribe,
 * hub.verify_token, and hub.challenge as query params. Echoing back the raw challenge (not JSON)
 * when the verify token matches is what completes the subscription.
 */
export function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

/**
 * Meta signs every webhook POST body with the app secret (`X-Hub-Signature-256: sha256=<hex hmac>`).
 * Must be computed over the exact raw bytes Meta sent, before any JSON parsing — this is why POST
 * below reads request.text() first instead of request.json().
 */
function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !signatureHeader?.startsWith('sha256=')) return false;

  const expectedHex = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const providedHex = signatureHeader.slice('sha256='.length);

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(providedHex, 'hex');
  if (expectedBuf.length === 0 || expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

type MetaMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
};

function extractMessages(payload: unknown): MetaMessage[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  const messages: MetaMessage[] = [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: unknown })?.value;
      const changeMessages = (value as { messages?: unknown })?.messages;
      if (Array.isArray(changeMessages)) messages.push(...(changeMessages as MetaMessage[]));
    }
  }
  return messages;
}

/**
 * Real inbound endpoint for the WhatsApp Business Cloud API, matching Meta's actual payload shape
 * and signing scheme — distinct from `/api/webhooks/messaging`, which is a generic bearer-secret
 * landing point kept for manual/internal testing with a simplified payload. Every insert here goes
 * through the same opt-out/consent machinery as the rest of the app (opt-out.ts).
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifyMetaSignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const messages = extractMessages(payload);

  let stored = 0;
  let optOutTriggered = false;

  for (const message of messages) {
    const providerMessageId = typeof message.id === 'string' ? message.id.slice(0, 255) : null;
    const fromDigits = typeof message.from === 'string' ? message.from.replace(/[^0-9]/g, '') : '';
    const phoneE164 = fromDigits ? `+${fromDigits}` : '';
    const messageText = typeof message.text?.body === 'string' ? message.text.body.slice(0, 4096) : '';
    const receivedAt = message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString();

    if (!providerMessageId || !isValidE164(phoneE164) || !messageText) continue;

    const insert = await supabaseRest('inbound_messages?on_conflict=provider_message_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify([
        { provider_message_id: providerMessageId, phone_e164: phoneE164, message_text: messageText, received_at: receivedAt, raw_payload: message },
      ]),
    });
    if (!insert.ok) continue;
    const inserted = await insert.json().catch(() => null);
    const isNewMessage = Array.isArray(inserted) && inserted.length > 0; // ignore-duplicates returns [] on a repeat delivery
    if (!isNewMessage) continue;
    stored += 1;

    await supabaseRest(`leads?phone_e164=eq.${encodeURIComponent(phoneE164)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_inbound_at: receivedAt }),
    });

    const keyword = detectOptOutKeyword(messageText);
    if (keyword) {
      const result = await applyOptOut(phoneE164, `keyword:${keyword}`, 'whatsapp_webhook');
      optOutTriggered = optOutTriggered || result.ok;
    }
  }

  // Meta expects a fast 200 regardless of per-message outcome, or it will retry and eventually
  // disable the subscription — never return a non-2xx here just because one message was malformed.
  return NextResponse.json({ success: true, stored, optOutTriggered });
}

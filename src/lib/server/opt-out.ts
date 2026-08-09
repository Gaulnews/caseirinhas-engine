import { supabaseRest } from './supabase-rest';

const E164 = /^\+[1-9]\d{7,14}$/;

export function isValidE164(value: string): boolean {
  return E164.test(value);
}

async function json<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null);
}

export type ApplyOptOutResult = { ok: true } | { ok: false; error: string };

/**
 * Single source of truth for "someone must stop receiving messages" — used by both the
 * admin-triggered opt-out endpoint and the inbound-message webhook's keyword detector.
 * Per the migration plan's "opt-out obrigatório": register the opt-out, mark the lead,
 * AND cancel any jobs already queued for that phone so a pending send doesn't slip through.
 */
export async function applyOptOut(phoneE164: string, reason: string | null, source: string): Promise<ApplyOptOutResult> {
  if (!isValidE164(phoneE164)) return { ok: false, error: 'phoneE164 must be E.164' };

  const optOut = await supabaseRest('opt_outs?on_conflict=phone_e164', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ phone_e164: phoneE164, channel: 'whatsapp', reason, source }]),
  });
  if (!optOut.ok) return { ok: false, error: 'Unable to register opt-out' };

  const leadsResponse = await supabaseRest(`leads?select=id&phone_e164=eq.${encodeURIComponent(phoneE164)}`);
  const leads = (await json<Array<{ id: string }>>(leadsResponse)) ?? [];

  await supabaseRest(`leads?phone_e164=eq.${encodeURIComponent(phoneE164)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'opted_out', opted_out_at: new Date().toISOString() }),
  });

  for (const lead of leads) {
    const recipientsResponse = await supabaseRest(`campaign_recipients?select=id&lead_id=eq.${lead.id}`);
    const recipients = (await json<Array<{ id: string }>>(recipientsResponse)) ?? [];
    if (recipients.length === 0) continue;
    const idList = recipients.map((recipient) => recipient.id).join(',');
    await supabaseRest(`message_jobs?campaign_recipient_id=in.(${idList})&status=in.(queued,processing)`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'cancelled', last_error: 'opt_out_received' }),
    });
  }

  return { ok: true };
}

const OPT_OUT_KEYWORDS = ['sair', 'parar', 'stop', 'remover', 'cancelar'];

const DIACRITIC_RANGE_START = String.fromCharCode(0x0300);
const DIACRITIC_RANGE_END = String.fromCharCode(0x036f);
const COMBINING_DIACRITICS = new RegExp(`[${DIACRITIC_RANGE_START}-${DIACRITIC_RANGE_END}]`, 'g');

/** Matches the WhatsApp policy requirement to honor opt-out keywords in either language. */
export function detectOptOutKeyword(messageText: string): string | null {
  const normalized = messageText
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .trim();
  const found = OPT_OUT_KEYWORDS.find((keyword) => normalized === keyword || normalized.startsWith(`${keyword} `));
  return found ?? null;
}

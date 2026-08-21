export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; errorCode?: string; errorMessage: string };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

/**
 * Sends a WhatsApp text message via Evolution API.
 *
 * Required env vars:
 *   MESSAGE_PROVIDER_URL      — Evolution API base URL (e.g. https://evo.yourhost.com)
 *   MESSAGE_PROVIDER_API_KEY  — value sent as the `apikey` header
 *   MESSAGE_PROVIDER_INSTANCE — instance name configured in Evolution API
 */
export async function sendWhatsAppText(
  phoneE164: string,
  text: string,
): Promise<SendResult> {
  const baseUrl = requiredEnv('MESSAGE_PROVIDER_URL').replace(/\/$/, '');
  const apiKey = requiredEnv('MESSAGE_PROVIDER_API_KEY');
  const instance = requiredEnv('MESSAGE_PROVIDER_INSTANCE');

  // Evolution API: number without leading + and with @s.whatsapp.net suffix
  const number = `${phoneE164.replace(/^\+/, '')}@s.whatsapp.net`;

  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/message/sendText/${encodeURIComponent(instance)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify({ number, text }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (err) {
    return {
      ok: false,
      errorCode: 'NETWORK_ERROR',
      errorMessage: err instanceof Error ? err.message : 'Network failure',
    };
  }

  const raw = await response.text().catch(() => '');
  if (!response.ok) {
    return {
      ok: false,
      errorCode: String(response.status),
      errorMessage: raw.slice(0, 500) || `HTTP ${response.status}`,
    };
  }

  let data: Record<string, unknown> = {};
  try { data = JSON.parse(raw); } catch { /* raw is not JSON */ }

  const keyId = (data?.key as Record<string, unknown> | undefined)?.id;
  const providerMessageId =
    typeof keyId === 'string' ? keyId :
    typeof data?.messageId === 'string' ? (data.messageId as string) :
    typeof data?.id === 'string' ? (data.id as string) : '';

  return { ok: true, providerMessageId };
}

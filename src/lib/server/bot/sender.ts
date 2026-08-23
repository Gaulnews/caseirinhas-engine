export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; errorCode?: string; errorMessage: string };

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Sends a WhatsApp text message via Evolution API.
 * Supports WAB_DRY_RUN=true to skip actual sends during testing.
 * Uses MESSAGE_PROVIDER_URL and MESSAGE_PROVIDER_API_KEY.
 * The `instance` param comes from the webhook event payload, so the bot
 * can serve both the `atendimento` and `vendas` instances.
 */
export async function sendBotText(
  instance: string,
  phoneE164: string,
  text: string,
): Promise<SendResult> {
  if (process.env.WAB_DRY_RUN === 'true') {
    console.log(`[bot:dry-run] ${instance} → ${phoneE164}: ${text.slice(0, 120)}`);
    return { ok: true, providerMessageId: 'dry-run' };
  }

  const baseUrl = getEnv('MESSAGE_PROVIDER_URL').replace(/\/$/, '');
  const apiKey = getEnv('MESSAGE_PROVIDER_API_KEY');
  const number = `${phoneE164.replace(/^\+/, '')}@s.whatsapp.net`;

  let res: Response;
  try {
    res = await fetch(
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
      errorMessage: err instanceof Error ? err.message : 'Network error',
    };
  }

  const raw = await res.text().catch(() => '');
  if (!res.ok) {
    return { ok: false, errorCode: String(res.status), errorMessage: raw.slice(0, 400) };
  }

  let data: Record<string, unknown> = {};
  try { data = JSON.parse(raw); } catch { /* not JSON */ }

  const keyId = (data?.key as Record<string, unknown> | undefined)?.id;
  const providerMessageId =
    typeof keyId === 'string' ? keyId :
    typeof data?.id === 'string' ? (data.id as string) : '';

  return { ok: true, providerMessageId };
}

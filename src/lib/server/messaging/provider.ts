export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; errorCode: string; errorMessage: string };

export interface MessagingProvider {
  /** `parameters` are ordered positional values for the approved template's {{1}}, {{2}}, ... body
   *  variables (see campaign-template.ts) — never free text. */
  send(phoneE164: string, parameters: string[]): Promise<SendResult>;
}

/**
 * Intentional no-op provider. The security migration this codebase came out of explicitly decided
 * that no real message should go out until a vetted provider, opt-out enforcement, and operational
 * review are all in place (see docs/SECURITY_MIGRATION.md). Wiring the old Baileys/caseirinhas-wpp
 * motor back in here is a deliberate, separate decision — not something to slot in by changing this
 * file's import. Swap the export below for a real adapter only after that decision is made.
 */
export class NullMessagingProvider implements MessagingProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature fixed by the MessagingProvider interface
  async send(_phoneE164: string, _parameters: string[]): Promise<SendResult> {
    return {
      ok: false,
      errorCode: 'messaging_provider_not_configured',
      errorMessage: 'No messaging provider is wired up. The job stays queued and is not marked as sent.',
    };
  }
}

/**
 * WhatsApp Business Cloud API (Meta) provider. Only ever called for jobs whose lead was
 * re-verified as `eligible` and opt-out-free immediately beforehand (see queue.ts) — this class
 * has no opinion on consent, it just sends what it's told to send.
 *
 * Sends an approved template with the campaign's `template_parameters` as its ordered body
 * variables. WhatsApp requires an approved template for any business-initiated message outside the
 * 24h customer-service window — this provider has no code path that accepts free text at all, so a
 * template can never be turned into an arbitrary marketing message (see campaign-template.ts).
 */
export class WhatsAppCloudApiProvider implements MessagingProvider {
  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly templateName: string,
    private readonly templateLanguage: string,
  ) {}

  async send(phoneE164: string, parameters: string[]): Promise<SendResult> {
    let response: Response;
    try {
      response = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phoneE164.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: this.templateName,
            language: { code: this.templateLanguage },
            components: [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) }],
          },
        }),
      });
    } catch (error) {
      return { ok: false, errorCode: 'network_error', errorMessage: error instanceof Error ? error.message : 'fetch failed' };
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        errorCode: body?.error?.code ? String(body.error.code) : `http_${response.status}`,
        errorMessage: body?.error?.message ?? `WhatsApp API returned ${response.status}`,
      };
    }

    const providerMessageId = body?.messages?.[0]?.id;
    if (!providerMessageId) {
      return { ok: false, errorCode: 'missing_message_id', errorMessage: 'WhatsApp API accepted the request but returned no message id' };
    }
    return { ok: true, providerMessageId };
  }
}

/**
 * Real sends require all three WHATSAPP_* env vars to be set (see .env.example and
 * docs/SECURITY_MIGRATION.md for how to obtain them). Missing/partial config degrades to
 * NullMessagingProvider on purpose — same graceful-degradation posture as auth.ts — rather than
 * throwing, so a misconfigured deployment fails jobs into `skipped`, not into a 500.
 */
export function getMessagingProvider(): MessagingProvider {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR';

  if (accessToken && phoneNumberId && templateName) {
    return new WhatsAppCloudApiProvider(accessToken, phoneNumberId, templateName, templateLanguage);
  }
  return new NullMessagingProvider();
}

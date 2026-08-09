export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; errorCode: string; errorMessage: string };

export interface MessagingProvider {
  send(phoneE164: string, text: string): Promise<SendResult>;
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
  async send(_phoneE164: string, _text: string): Promise<SendResult> {
    return {
      ok: false,
      errorCode: 'messaging_provider_not_configured',
      errorMessage: 'No messaging provider is wired up. The job stays queued and is not marked as sent.',
    };
  }
}

export function getMessagingProvider(): MessagingProvider {
  return new NullMessagingProvider();
}

import { supabaseRest } from './supabase-rest';

export async function logAudit(params: {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await supabaseRest('audit_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([
      {
        actor_id: params.actorId,
        action: params.action,
        entity_type: params.entityType,
        entity_id: params.entityId ?? null,
        metadata: params.metadata ?? {},
      },
    ]),
  }).catch(() => {
    // Audit logging must never block the primary action; failures are swallowed intentionally.
  });
}

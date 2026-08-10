/**
 * Single source of truth for legal lead-status transitions, shared by the API route
 * (src/app/api/leads/[id]/route.ts) and the panel Server Action (src/app/painel/actions.ts) —
 * previously duplicated verbatim in both files, risking silent drift between what the API and the
 * panel each consider a legal transition for the eligibility gate.
 */
export const LEAD_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending_review: ['eligible', 'invalid'],
  eligible: ['blocked', 'pending_review'],
  invalid: ['pending_review'],
  blocked: ['pending_review'],
};

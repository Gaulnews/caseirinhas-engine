-- Closes a template-laundering gap: the messaging provider previously sent campaigns.message_template
-- verbatim as the approved WhatsApp template's {{1}} body variable, which let a free-text field turn
-- an approved template into an arbitrary marketing message. From this migration on, the provider only
-- ever sends the structured, positional values in template_parameters ("1", "2", ... -> {{1}}, {{2}}, ...).
-- message_template is kept as-is: staff-facing documentation of what the campaign is for, never sent
-- to WhatsApp directly.

alter table public.campaigns
  add column template_parameters jsonb not null default '{}'::jsonb,
  add column template_category text not null default 'MARKETING'
    check (template_category in ('MARKETING', 'UTILITY', 'AUTHENTICATION'));

comment on column public.campaigns.template_parameters is
  'Ordered WhatsApp template body-variable values, keyed "1","2",... matching {{1}},{{2}},... in WHATSAPP_TEMPLATE_NAME. This is the only content the messaging provider sends -- message_template is never sent to WhatsApp verbatim.';
comment on column public.campaigns.template_category is
  'Informational/audit only. The template''s real category is fixed on the template itself in Meta Business Manager when it is approved, not chosen per-send.';

import { notFound } from 'next/navigation';
import { supabaseRest } from '../../../../lib/server/supabase-rest';
import { getPageStaffSession } from '../../../../lib/server/page-session';
import { roleMeetsMinimum } from '../../../../lib/server/roles';
import { startCampaignAction, pauseCampaignAction, resumeCampaignAction, cancelCampaignAction } from '../../actions';

export const dynamic = 'force-dynamic';

type CampaignDetail = {
  id: string;
  name: string;
  message_template: string;
  template_category: string;
  template_parameters: Record<string, string>;
  status: string;
  daily_limit: number;
  min_interval_seconds: number;
  started_at: string | null;
  completed_at: string | null;
};

async function loadCampaign(id: string) {
  const response = await supabaseRest(
    `campaigns?id=eq.${id}&select=id,name,message_template,template_category,template_parameters,status,daily_limit,min_interval_seconds,started_at,completed_at`,
  );
  const rows = await response.json().catch(() => null);
  return (rows?.[0] as CampaignDetail | undefined) ?? null;
}

async function loadRecipientCounts(id: string) {
  const response = await supabaseRest(`campaign_recipients?select=status&campaign_id=eq.${id}`);
  const rows = ((await response.json().catch(() => [])) as Array<{ status: string }>) ?? [];
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, recipientsByStatus, session] = await Promise.all([
    loadCampaign(id),
    loadRecipientCounts(id),
    getPageStaffSession(),
  ]);
  if (!campaign) notFound();

  const canManage = session ? roleMeetsMinimum(session.role, 'owner') : false;
  const totalRecipients = Object.values(recipientsByStatus).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{campaign.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Status: <span className="font-semibold text-amber-400">{campaign.status}</span> · Limite diário {campaign.daily_limit} · Intervalo mínimo {campaign.min_interval_seconds}s
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-2 text-sm font-bold text-zinc-400">Descrição interna</h2>
        <p className="whitespace-pre-wrap text-sm">{campaign.message_template}</p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-2 text-sm font-bold text-zinc-400">
          Template WhatsApp enviado ({campaign.template_category})
        </h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {Object.entries(campaign.template_parameters ?? {})
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([key, value]) => (
              <span key={key} className="rounded-full border border-zinc-800 px-3 py-1 font-mono text-xs">
                {`{{${key}}}`} = {value}
              </span>
            ))}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-2 text-sm font-bold text-zinc-400">Destinatários ({totalRecipients})</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          {Object.entries(recipientsByStatus).map(([status, count]) => (
            <span key={status} className="rounded-full border border-zinc-800 px-3 py-1">
              {status}: {count}
            </span>
          ))}
          {totalRecipients === 0 && <span className="text-zinc-500">Ainda não iniciada.</span>}
        </div>
      </div>

      {canManage && (
        <div className="flex gap-3">
          {campaign.status === 'draft' && (
            <form action={startCampaignAction.bind(null, campaign.id)}>
              <button type="submit" className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950">
                Iniciar campanha
              </button>
            </form>
          )}
          {campaign.status === 'running' && (
            <form action={pauseCampaignAction.bind(null, campaign.id)}>
              <button type="submit" className="rounded-lg border border-zinc-700 px-4 py-2 text-sm">
                Pausar
              </button>
            </form>
          )}
          {campaign.status === 'paused' && (
            <form action={resumeCampaignAction.bind(null, campaign.id)}>
              <button type="submit" className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950">
                Retomar
              </button>
            </form>
          )}
          {(campaign.status === 'running' || campaign.status === 'paused' || campaign.status === 'draft') && (
            <form action={cancelCampaignAction.bind(null, campaign.id)}>
              <button type="submit" className="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-300">
                Cancelar
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

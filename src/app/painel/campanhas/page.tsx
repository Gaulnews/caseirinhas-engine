import Link from 'next/link';
import { supabaseRest } from '../../../lib/server/supabase-rest';
import { getPageStaffSession } from '../../../lib/server/page-session';
import { roleMeetsMinimum } from '../../../lib/server/roles';
import { createCampaignAction } from '../actions';

export const dynamic = 'force-dynamic';

type Campaign = { id: string; name: string; status: string; daily_limit: number; created_at: string };

async function loadCampaigns() {
  const response = await supabaseRest(
    'campaigns?select=id,name,status,daily_limit,created_at&order=created_at.desc&limit=100',
  );
  if (!response.ok) return [] as Campaign[];
  return (await response.json()) as Campaign[];
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Em execução',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export default async function CampanhasPage() {
  const [campaigns, session] = await Promise.all([loadCampaigns(), getPageStaffSession()]);
  const canCreate = session ? roleMeetsMinimum(session.role, 'operator') : false;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Campanhas</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Toda campanha nasce como rascunho. Iniciar (owner) só envia para leads já aprovados — nenhum envio real acontece até um provedor de mensageria ser configurado.
        </p>
      </div>

      {canCreate && (
        <form action={createCampaignAction} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="font-bold text-amber-400">Nova campanha (rascunho)</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm text-zinc-400">
              Nome
              <input name="name" required minLength={2} maxLength={140} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-zinc-100" />
            </label>
            <label className="space-y-1 text-sm text-zinc-400">
              Limite diário
              <input name="dailyLimit" type="number" defaultValue={20} min={0} max={100} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-zinc-100" />
            </label>
            <label className="space-y-1 text-sm text-zinc-400 sm:col-span-2">
              Descrição interna (não é enviada ao WhatsApp — só documenta o propósito da campanha)
              <textarea name="messageTemplate" required rows={2} maxLength={4096} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-zinc-100" />
            </label>
            <label className="space-y-1 text-sm text-zinc-400">
              Categoria do template aprovado
              <select name="templateCategory" defaultValue="MARKETING" className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-zinc-100">
                <option value="MARKETING">MARKETING</option>
                <option value="UTILITY">UTILITY</option>
                <option value="AUTHENTICATION">AUTHENTICATION</option>
              </select>
            </label>
            <label className="space-y-1 text-sm text-zinc-400">
              Intervalo mínimo entre envios (segundos)
              <input name="minIntervalSeconds" type="number" defaultValue={90} min={60} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-zinc-100" />
            </label>
            <label className="space-y-1 text-sm text-zinc-400 sm:col-span-2">
              Parâmetros do template (JSON) — só valores nas posições {'{{1}}, {{2}}, ...'} do template já
              aprovado pela Meta ({`WHATSAPP_TEMPLATE_NAME`}). Nunca é texto livre.
              <textarea
                name="templateParameters"
                required
                rows={3}
                placeholder='{"1": "segunda-feira", "2": "Bife à parmegiana com arroz e feijão", "3": "R$ 22,00"}'
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 font-mono text-xs text-zinc-100"
              />
            </label>
          </div>
          <button type="submit" className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950">
            Criar rascunho
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="p-3">Nome</th>
              <th className="p-3">Status</th>
              <th className="p-3">Limite diário</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td className="p-3">{campaign.name}</td>
                <td className="p-3">{STATUS_LABEL[campaign.status] ?? campaign.status}</td>
                <td className="p-3">{campaign.daily_limit}</td>
                <td className="p-3">
                  <Link href={`/painel/campanhas/${campaign.id}`} className="text-amber-400 hover:underline">
                    Ver detalhes
                  </Link>
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-zinc-500">
                  Nenhuma campanha criada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

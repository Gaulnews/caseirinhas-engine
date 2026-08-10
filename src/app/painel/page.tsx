import { supabaseRest } from '../../lib/server/supabase-rest';
import { getPageStaffSession } from '../../lib/server/page-session';
import { roleMeetsMinimum } from '../../lib/server/roles';
import { setLeadStatusAction } from './actions';

export const dynamic = 'force-dynamic';

type Lead = {
  id: string;
  company_name: string;
  phone_e164: string;
  neighborhood: string | null;
  status: string;
  created_at: string;
};

async function loadLeads(status: string) {
  const query = new URLSearchParams({
    select: 'id,company_name,phone_e164,neighborhood,status,created_at',
    deleted_at: 'is.null',
    order: 'created_at.desc',
    limit: '100',
  });
  if (status) query.set('status', `eq.${status}`);
  const response = await supabaseRest(`leads?${query.toString()}`);
  if (!response.ok) return [] as Lead[];
  return (await response.json()) as Lead[];
}

const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Pendente de revisão',
  eligible: 'Elegível',
  contacted: 'Contatado',
  responded: 'Respondeu',
  opted_out: 'Optou por sair',
  invalid: 'Inválido',
  blocked: 'Bloqueado',
};

export default async function PainelLeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = 'pending_review' } = await searchParams;
  const [leads, session] = await Promise.all([loadLeads(status), getPageStaffSession()]);
  const canApprove = session ? roleMeetsMinimum(session.role, 'operator') : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leads</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Nenhum lead entra em campanha sem revisão manual. {STATUS_LABEL[status] ?? status} agora.
        </p>
      </div>

      <div className="flex gap-2 text-sm">
        {Object.entries(STATUS_LABEL).map(([value, label]) => (
          <a
            key={value}
            href={`/painel?status=${value}`}
            className={`rounded-full border px-3 py-1 ${status === value ? 'border-amber-400 text-amber-400' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}
          >
            {label}
          </a>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="p-3">Empresa</th>
              <th className="p-3">WhatsApp</th>
              <th className="p-3">Bairro</th>
              <th className="p-3">Status</th>
              {canApprove && status === 'pending_review' && <th className="p-3">Ações</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td className="p-3">{lead.company_name}</td>
                <td className="p-3 font-mono">{lead.phone_e164}</td>
                <td className="p-3">{lead.neighborhood ?? '—'}</td>
                <td className="p-3">{STATUS_LABEL[lead.status] ?? lead.status}</td>
                {canApprove && status === 'pending_review' && (
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={setLeadStatusAction.bind(null, lead.id, 'eligible')} className="flex items-center gap-2">
                        <input
                          name="consentProofReference"
                          required
                          placeholder="Evidência de consentimento (obrigatório)"
                          className="w-56 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600"
                        />
                        <button type="submit" className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-300 hover:bg-emerald-500/30">
                          Aprovar
                        </button>
                      </form>
                      <form action={setLeadStatusAction.bind(null, lead.id, 'invalid')}>
                        <button type="submit" className="rounded bg-red-500/20 px-2 py-1 text-red-300 hover:bg-red-500/30">
                          Rejeitar
                        </button>
                      </form>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-zinc-500">
                  Nenhum lead nesse status.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

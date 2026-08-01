"use client";
import React, { useState } from 'react';
import { Play, MapPin, CheckCircle2 } from 'lucide-react';
import { DATABASE, Lead } from '../data/leads';

const PRIORIDADES = ['cinco conjuntos', 'semiramis', 'coliseu', 'violim', 'gavetti', 'joão paz', 'alpes', 'parigot'];

export default function App() {
  const [status, setStatus] = useState<'idle' | 'running'>('idle');
  
  const leads = [...DATABASE].sort((a, b) => {
    const aP = PRIORIDADES.some(p => a.bairro.toLowerCase().includes(p));
    const bP = PRIORIDADES.some(p => b.bairro.toLowerCase().includes(p));
    return aP === bP ? 0 : aP ? -1 : 1;
  });

  // Botão agora faz a chamada REAL para a Vercel, que bate no seu Termux
  const disparar = async (obj: number) => {
    setStatus('running');
    try {
      const response = await fetch(`/api/cron?objective=${obj}&secret=senha_secreta_tata_2026`);
      const data = await response.json();
      
      if(data.success) {
        alert(`✅ Disparo concluído! ${data.disparos_processados} leads processados pelo motor (43) 9 9982-1401.`);
      } else {
        alert(`⚠️ Erro na resposta do servidor.`);
      }
    } catch (error) {
      alert(`❌ Falha ao tentar conectar com a automação.`);
    }
    setStatus('idle');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-gray-100 p-6">
      <header className="flex justify-between items-center mb-8 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-yellow-400 flex items-center justify-center font-bold text-zinc-900 text-xl">CT</div>
          <div><h1 className="text-2xl font-bold">Caseirinhas Engine</h1><p className="text-zinc-400">{DATABASE.length} Leads Ativos | WPP: (43) 9 9982-1401</p></div>
        </div>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-4">
          <div className="bg-zinc-900 p-6 rounded-xl border border-zinc-800">
            <h2 className="font-bold mb-4 flex items-center gap-2"><Play className="w-5 h-5 text-yellow-400"/> Ações Vercel</h2>
            <button onClick={() => disparar(1)} disabled={status==='running'} className="w-full text-left p-4 mb-2 bg-zinc-800 rounded-lg hover:border-yellow-400 border border-transparent transition-colors">1. Cardápio do Dia</button>
            <button onClick={() => disparar(2)} disabled={status==='running'} className="w-full text-left p-4 mb-2 bg-zinc-800 rounded-lg hover:border-yellow-400 border border-transparent transition-colors">2. Pacotes B2B</button>
            <button onClick={() => disparar(3)} disabled={status==='running'} className="w-full text-left p-4 bg-zinc-800 rounded-lg hover:border-yellow-400 border border-transparent transition-colors">3. Agendar Degustação</button>
            {status === 'running' && <p className="text-yellow-400 text-xs mt-2 font-bold animate-pulse">Disparando via Termux...</p>}
          </div>
        </div>
        <div className="md:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h3 className="font-bold flex items-center gap-2 mb-4"><MapPin className="text-yellow-400"/> Fila de Prospecção (Prioridade Norte)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left"><thead className="text-zinc-400"><tr><th>Empresa</th><th>Bairro</th><th>WPP</th></tr></thead>
            <tbody>{leads.slice(0,10).map((l: Lead) => <tr key={l.id} className="border-t border-zinc-800"><td className="py-2">{l.nome}</td><td className="text-zinc-400">{PRIORIDADES.some(p => l.bairro.toLowerCase().includes(p)) ? <span className="text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/>{l.bairro}</span> : l.bairro}</td><td>{l.telefone}</td></tr>)}</tbody></table>
          </div>
        </div>
      </div>
    </div>
  );
}

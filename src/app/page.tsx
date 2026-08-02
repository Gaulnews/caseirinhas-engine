"use client";
import React, { useState, useEffect } from 'react';
import { Play, MapPin, CheckCircle2, MessageSquare, Send, RefreshCw, Search } from 'lucide-react';
import { DATABASE, Lead } from '../data/leads';

const PRIORIDADES = ['cinco conjuntos', 'semiramis', 'coliseu', 'violim', 'gavetti', 'joão paz', 'alpes', 'parigot'];

export default function App() {
  const [status, setStatus] = useState<'idle' | 'running'>('idle');
  const [aba, setAba] = useState<'disparos' | 'respostas'>('disparos');
  const [customMsg, setCustomMsg] = useState('Olá equipe! Aqui é da Caseirinhas da Tatá. Temos almoço quentinho hoje com entrega rápida aí na região. Posso enviar o cardápio?');
  const [respostasWpp, setRespostasWpp] = useState<any[]>([]);
  const [logsExecucao, setLogsExecucao] = useState<any[]>([]);
  const [termoBusca, setTermoBusca] = useState(''); // Estado para a barra de pesquisa

  const buscarRespostas = async () => {
    try {
      const res = await fetch('https://caseirinhas-wpp.onrender.com/api/responses');
      const data = await res.json();
      if(data.success) setRespostasWpp(data.respostas);
    } catch (e) {
      console.error("Erro ao buscar respostas");
    }
  };

  useEffect(() => {
    const interval = setInterval(buscarRespostas, 5000);
    return () => clearInterval(interval);
  }, []);

  // Ordenação de prioridade da Zona Norte
  const leadsOrdenados = [...DATABASE].sort((a, b) => {
    const aP = PRIORIDADES.some(p => a.bairro.toLowerCase().includes(p));
    const bP = PRIORIDADES.some(p => b.bairro.toLowerCase().includes(p));
    return aP === bP ? 0 : aP ? -1 : 1;
  });

  // Filtro de Busca Inteligente em Tempo Real
  const leadsFiltrados = leadsOrdenados.filter(lead => 
    lead.nome.toLowerCase().includes(termoBusca.toLowerCase()) || 
    lead.bairro.toLowerCase().includes(termoBusca.toLowerCase()) ||
    lead.telefone.includes(termoBusca)
  );

  const dispararLote = async (obj: number) => {
    setStatus('running');
    try {
      const response = await fetch(`/api/cron?objective=${obj}&secret=senha_secreta_tata_2026&customMessage=${encodeURIComponent(customMsg)}`);
      const data = await response.json();
      
      setLogsExecucao(prev => [data, ...prev]);
      if(data.success) {
        alert(`✅ Lote processado! ${data.disparos_processados} mensagens enviadas com sucesso.`);
      } else {
        alert(`⚠️ Erro ao processar o lote.`);
      }
    } catch (error) {
      alert(`❌ Falha na conexão com a automação.`);
    }
    setStatus('idle');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-gray-100 p-6 font-sans">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-zinc-800 pb-4 gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-yellow-400 flex items-center justify-center font-bold text-zinc-900 text-xl shadow-lg shadow-yellow-500/20">CT</div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Caseirinhas Engine <span className="text-xs bg-yellow-400/10 text-yellow-400 px-2 py-1 rounded border border-yellow-400/20">PRO v4.0</span></h1>
            <p className="text-zinc-400 text-sm">{DATABASE.length} Leads Ativos na Base | WhatsApp: (43) 9 9982-1401</p>
          </div>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={() => setAba('disparos')} className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-colors ${aba === 'disparos' ? 'bg-yellow-400 text-zinc-950 font-bold' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}>🚀 Disparos</button>
          <button onClick={() => setAba('respostas')} className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-colors relative ${aba === 'respostas' ? 'bg-yellow-400 text-zinc-950 font-bold' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}>
            💬 Caixa de Entrada 
            {respostasWpp.length > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center font-bold">{respostasWpp.length}</span>}
          </button>
        </div>
      </header>

      {aba === 'disparos' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <div className="bg-zinc-900 p-6 rounded-xl border border-zinc-800 shadow-xl">
              <h2 className="font-bold mb-4 flex items-center gap-2 text-yellow-400"><Send className="w-5 h-5"/> Editor de Mensagem</h2>
              <textarea 
                value={customMsg}
                onChange={(e) => setCustomMsg(e.target.value)}
                rows={4}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-200 focus:outline-none focus:border-yellow-400 mb-4 transition-colors"
                placeholder="Sua copy B2B..."
              />
              <h3 className="font-bold mb-3 flex items-center gap-2 text-sm text-zinc-300"><Play className="w-4 h-4 text-yellow-400"/> Iniciar Operação</h3>
              <button onClick={() => dispararLote(1)} disabled={status==='running'} className="w-full text-left p-3 mb-2 bg-zinc-800 rounded-lg hover:border-yellow-400 border border-transparent transition-all text-sm font-medium">1. Enviar Cardápio (Lote Seguro)</button>
              <button onClick={() => dispararLote(2)} disabled={status==='running'} className="w-full text-left p-3 mb-2 bg-zinc-800 rounded-lg hover:border-yellow-400 border border-transparent transition-all text-sm font-medium">2. Propostas para Empresas (B2B)</button>
              {status === 'running' && <p className="text-yellow-400 text-xs mt-3 font-bold animate-pulse flex items-center gap-2"><RefreshCw className="w-3 h-3 animate-spin"/> Conectando ao Render e processando...</p>}
            </div>
          </div>

          <div className="lg:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800 p-6 shadow-xl flex flex-col h-[600px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold flex items-center gap-2 text-yellow-400"><MapPin/> Base de Dados ({leadsFiltrados.length})</h3>
              
              {/* Barra de Pesquisa */}
              <div className="relative w-64">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                  <Search className="w-4 h-4 text-zinc-500" />
                </div>
                <input 
                  type="text" 
                  value={termoBusca}
                  onChange={(e) => setTermoBusca(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 text-zinc-200 text-sm rounded-lg focus:ring-yellow-400 focus:border-yellow-400 block w-full pl-10 p-2" 
                  placeholder="Buscar empresa ou bairro..." 
                />
              </div>
            </div>

            <div className="overflow-x-auto overflow-y-auto flex-1 pr-2 custom-scrollbar">
              <table className="w-full text-sm text-left">
                <thead className="text-zinc-400 sticky top-0 bg-zinc-900 border-b border-zinc-800 shadow-sm">
                  <tr><th className="pb-3">Empresa</th><th className="pb-3">Bairro</th><th className="pb-3">WhatsApp</th></tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {leadsFiltrados.length > 0 ? (
                    leadsFiltrados.map((l: Lead) => (
                      <tr key={l.id} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3 font-medium text-zinc-200 truncate max-w-[200px]" title={l.nome}>{l.nome}</td>
                        <td className="text-zinc-400">
                          {PRIORIDADES.some(p => l.bairro.toLowerCase().includes(p)) ? (
                            <span className="text-green-400 flex items-center gap-1 font-semibold"><CheckCircle2 className="w-3.5 h-3.5"/>{l.bairro}</span>
                          ) : (
                            <span className="truncate max-w-[150px] inline-block" title={l.bairro}>{l.bairro}</span>
                          )}
                        </td>
                        <td className="text-zinc-300 font-mono">{l.telefone}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={3} className="text-center py-8 text-zinc-500">Nenhum lead encontrado com esse termo.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 shadow-xl max-w-4xl mx-auto">
          {/* Aba de Respostas (mantida) */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2 text-yellow-400"><MessageSquare/> Respostas Recebidas</h2>
            <button onClick={buscarRespostas} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs rounded-lg flex items-center gap-1 text-zinc-300"><RefreshCw className="w-3 h-3"/> Atualizar</button>
          </div>
          {respostasWpp.length === 0 ? (
            <div className="text-center py-16 text-zinc-500"><MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20"/><p>Aguardando interações dos clientes.</p></div>
          ) : (
            <div className="space-y-3">
              {respostasWpp.map((resp, idx) => (
                <div key={idx} className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 flex justify-between items-start">
                  <div>
                    <span className="text-xs font-mono text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded border border-yellow-400/20">Tel: {resp.telefone}</span>
                    <p className="text-sm text-zinc-200 mt-2 font-medium">{resp.mensagem}</p>
                  </div>
                  <span className="text-xs text-zinc-500">{resp.horario}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

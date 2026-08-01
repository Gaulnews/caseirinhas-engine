import { NextResponse } from 'next/server';
import { DATABASE, Lead } from '@/data/leads';

export const runtime = 'edge';

const PRIORIDADES = ['cinco conjuntos', 'semiramis', 'coliseu', 'violim', 'gavetti', 'joão paz', 'alpes', 'parigot'];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const objective = searchParams.get('objective') || '1';
  const secret = searchParams.get('secret') || 'senha_secreta_tata_2026';
  
  // URL DEFINITIVA DO MOTOR NA NUVEM (Render)
  const motorUrl = 'https://caseirinhas-wpp.onrender.com';

  const leadsPrioritarios = [...DATABASE].sort((a, b) => {
    const aP = PRIORIDADES.some(p => a.bairro?.toLowerCase().includes(p));
    const bP = PRIORIDADES.some(p => b.bairro?.toLowerCase().includes(p));
    return aP === bP ? 0 : aP ? -1 : 1;
  });

  const lote = leadsPrioritarios
    .filter(lead => lead.telefone && lead.telefone.replace(/\D/g, '').length >= 10)
    .slice(0, 2);

  const resultados = [];

  for (const lead of lote) {
    const telefoneLimpo = lead.telefone.replace(/\D/g, '');
    const primeiroNome = lead.nome.split(' ')[0];

    let mensagem = '';
    if (objective === '1') {
      mensagem = `Olá equipe da ${primeiroNome}! 🍲 Aqui é da Caseirinhas da Tatá. Hoje temos Bife à Parmegiana com arroz soltinho e feijão caseiro saindo quentinho. Entregamos super rápido aí na região do ${lead.bairro}. Posso mandar o cardápio completo de hoje?`;
    } else if (objective === '2') {
      mensagem = `Olá ${primeiroNome}! Tudo bem? Sabemos que a rotina na ${lead.nome} é corrida. Vocês costumam pedir almoço para a equipe? Temos pacotes semanais e mensais B2B para empresas na região do ${lead.bairro} com valores especiais e entrega grátis.`;
    } else if (objective === '3') {
      mensagem = `Olá! Sou representante da Caseirinhas da Tatá. Estamos fechando parcerias de fornecimento de refeições para empresas aí no ${lead.bairro}. Teria 5 minutos essa semana para eu levar uma degustação sem custo para a equipe da ${lead.nome}?`;
    }

    try {
      const response = await fetch(`${motorUrl}/api/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          secret: secret,
          phone: telefoneLimpo,
          message: mensagem,
        }),
      });

      const resData = await response.json().catch(() => ({ status: 'enviado' }));
      resultados.push({
        empresa: lead.nome,
        bairro: lead.bairro,
        telefone: telefoneLimpo,
        status: response.ok ? 'sucesso' : 'falha_api',
        http_status: response.status,
        resposta_motor: resData,
      });
    } catch (error: any) {
      resultados.push({
        empresa: lead.nome,
        bairro: lead.bairro,
        telefone: telefoneLimpo,
        status: 'erro_conexao_motor',
        detalhe: error.message,
      });
    }
  }

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    objetivo_executado: objective,
    motor_url: motorUrl,
    disparos_processados: resultados.length,
    detalhes: resultados,
  });
}

# Análise Aprofundada — Migração de Segurança B2B do Caseirinhas Engine

**Task**: TAREFA-ANALISE-01
**Documento-fonte analisado**: sessão Perplexity "Garoto de programa" (nome da space não corresponde ao conteúdo, que trata integralmente de engenharia de software — importação de leads B2B via Google Places, automação de WhatsApp e revisão de segurança/LGPD do sistema Caseirinhas)
**Data da análise**: 2026-08-09
**Repositórios envolvidos**: `Gaulnews/caseirinhas-tata-next` (vitrine/SEO), `Gaulnews/caseirinhas-engine` (painel/CRM — "Cérebro"), `Gaulnews/caseirinhas-wpp` (motor WhatsApp via Baileys, hospedado no Render)

> **Declaração de uso de IA**: esta análise foi produzida com ferramentas de IA (Claude), seguindo a estrutura de análise definida em `SKILL.md` (deep-research), `research_architect_agent.md`, `synthesis_agent.md`, `report_compiler_agent.md`, `socratic_mentor_agent.md` e `devils_advocate_agent.md`. Todas as afirmações sobre o estado dos repositórios foram verificadas diretamente via GitHub (API/MCP) e clone local em 2026-08-09, não apenas inferidas do documento-fonte.

---

## Abstract

Este relatório documenta a extração integral, em duas passadas, do conteúdo de uma sessão de trabalho longa (22 blocos de interação, ~2.840 linhas) na qual um assistente de IA conduziu — do zero até a execução real em produção — a construção de um sistema de prospecção B2B via WhatsApp para a "Caseirinhas da Tatá": importação de 652 leads do Google Places, criação de um painel de disparo, um diagnóstico crítico de segurança/LGPD/arquitetura, e a execução de uma migração de contenção (branch `security/supabase-campaign-architecture`, PR #1 draft no repositório `caseirinhas-engine`). A análise não se limitou ao texto: cada afirmação de execução foi cruzada com o estado real dos três repositórios GitHub e do clone local. O resultado confirma que a maior parte das ações relatadas de fato ocorreu, mas identifica **três achados críticos ainda ativos em produção** (segredo hardcoded exposto no cliente, 652 telefones pessoais versionados publicamente, e a branch de correção nunca mesclada em `master`), além de lacunas de conformidade LGPD e uma etapa de blindagem do `.gitignore` no `caseirinhas-wpp` que nunca foi aplicada. O documento serve como base de conhecimento para ações futuras.

---

## 1. Introdução e Contexto

O ecossistema "Caseirinhas" é composto por três aplicações que se comunicam entre si:

| Repositório | Papel | Stack |
|---|---|---|
| `caseirinhas-tata-next` | Site/vitrine público, SEO | Next.js |
| `caseirinhas-engine` | Painel administrativo / CRM de prospecção B2B ("Cérebro") | Next.js, hospedado na Vercel |
| `caseirinhas-wpp` | Motor de conexão WhatsApp (Baileys), sessão persistida em disco | Node.js, hospedado no Render |

O documento analisado é uma transcrição integral de uma sessão de trabalho no Perplexity Spaces (nome da space: "Garoto de programa" — sem relação temática com o conteúdo, que é inteiramente técnico) em que o usuário e um assistente de IA:

1. Escreveram e depuraram um script Node (`importar_leads.js`) para transformar um CSV do Google Places/Apify em uma base de 652 leads B2B, injetada diretamente em `src/data/leads.ts`.
2. Resolveram uma série de problemas operacionais (pasta errada, arquivo com nome diferente do esperado, Android Scoped Storage, conflito `main`/`master`, reconexão do motor WhatsApp no Render, bloqueio de rate-limit da Meta).
3. Implementaram um painel com busca/filtro em tempo real sobre os 652 leads.
4. Passaram por um diagnóstico crítico ("Advogado do Diabo") que apontou falhas graves de segurança, LGPD e arquitetura.
5. Executaram, de fato, uma primeira fase de correção: criação de schema Supabase, remoção da base estática do código, desativação da rota de cron pública, criação de um importador CSV auditável, e abertura da PR #1 em modo draft — interrompida no momento em que o conector Vercel estava desconectado e um bug no parser CSV (`\n+` em vez de `\n`) bloqueava o teste.

---

## 2. Blueprint Metodológico da Análise (padrão `research_architect_agent`)

- **Paradigma**: pragmatista/aplicado — o objetivo não é gerar conhecimento teórico generalizável, mas produzir compreensão acionável e fiel do conteúdo de um documento técnico real, ligado a sistemas de produção existentes.
- **Método**: análise documental qualitativa em duas passadas (primeira leitura extrativa + segunda passada de aprofundamento), seguida de **triangulação** com evidência primária externa (estado real dos três repositórios via GitHub API/MCP e clone local).
- **Estratégia de dados**: fonte primária = transcrição completa do documento (`Garoto_de_programa...md`, 2.838 linhas). Fonte secundária de verificação = `git log`, `git diff`, `git branch -a`, conteúdo de arquivos, PR #1 (status, commits, diff, checks) nos três repositórios.
- **Framework analítico**: síntese temática (`synthesis_agent`) + checkpoint crítico obrigatório (`devils_advocate_agent`) + compilação estruturada (`report_compiler_agent`) + extração de INSIGHTs discretos e memorizáveis (mecanismo do `socratic_mentor_agent`).
- **Critério de validade**: toda afirmação sobre "o que foi feito" é marcada como **[DOCUMENTO]** (afirmado no texto-fonte, não verificado independentemente) ou **[VERIFICADO]** (confirmado contra o estado real do repositório nesta análise).

---

## 3. Linha do Tempo Integral Extraída (síntese cronológica)

| # | Fase do documento | Conteúdo extraído |
|---|---|---|
| 1 | Script de injeção inicial | `importar_leads.js`: lê `dataset.csv`, split por regex sensível a aspas, mapeia colunas do Apify (`title`/`name`, `phone`/`phoneUnformatted`/`phoneNumber`, `address`/`neighborhood`), limpa telefone (`\D` removido), exige ≥10 dígitos, extrai bairro por `split('-')`, grava `src/data/leads.ts` como array TS estático |
| 2 | Depuração operacional | Erros reais tratados: `pathspec did not match` (pasta errada — script rodado em `caseirinhas-tata-next` em vez de `caseirinhas-engine`); Android Scoped Storage escondendo o CSV baixado; nome de arquivo inesperado (`data-set-01.csv`); `git pull` necessário antes de push por edições feitas via navegador GitHub; branch `main` vs `master` inconsistente entre repositórios |
| 3 | Upgrade de UI | Reescrita de `src/app/page.tsx` com busca/filtro client-side em tempo real (`termoBusca`), ordenação por bairros prioritários (Zona Norte), duas abas (Disparos/Caixa de Entrada), polling de respostas a cada 5s via `fetch` para `caseirinhas-wpp.onrender.com/api/responses` |
| 4 | Diagnóstico crítico | Tabela de 7 áreas avaliadas (Importação CSV, Banco de dados, Segurança, WhatsApp, LGPD, Deploy/infra, Git) — todas marcadas Crítica/Inadequada/Frágil, exceto importação CSV ("parcialmente adequada") |
| 5 | Plano de correção arquitetural | Arquitetura-alvo completa: Next.js admin autenticado → API server-side com RBAC/Zod/audit → Supabase Postgres + fila de campanhas persistente → adaptador de mensageria → WhatsApp. Schema SQL completo com 11 tabelas (`leads`, `lead_imports`, `campaigns`, `message_jobs`, `opt_outs`, `audit_logs` etc.), enums de status, regra de elegibilidade SQL, fases de migração A→E |
| 6 | Decisão de infraestrutura | Recusa em reutilizar projeto Supabase "Formulário" (inativo, não confirmado como pertencente ao CRM); decisão por projeto dedicado `caseirinhas-engine-staging`, região `sa-east-1`, org `szfwfemuvwqiupyabwgm` |
| 7 | Execução real (contenção) | **[VERIFICADO]** branch `security/supabase-campaign-architecture` criada a partir de `master`; migration SQL versionada (`...create_secure_campaign_foundation.sql`); `src/data/leads.ts` e `importar_leads.js` removidos da branch; `/api/cron` retorna HTTP 410; endpoints protegidos criados (`GET /api/leads` paginado com Bearer token, `POST /api/opt-outs`) |
| 8 | Importador CSV auditável | `POST /api/imports`, multipart até 2 MiB, parser próprio tolerante a aspas/quebras internas, normalização E.164, rejeição de duplicatas/telefones inválidos/opt-outs, grava tudo como `pending_review`, nunca `eligible` |
| 9 | Abertura da PR #1 | PR draft `security/supabase-campaign-architecture → master` com checklist de segurança explícito, sem merge automático |
| 10 | Revisão encontrou 2 bloqueios | (a) build da Vercel com `status: failure`; (b) bug real no parser: `src/lib/server/csv.ts` continha `else if (char === '\n+')` em vez de `else if (char === '\n')`, quebrando o reconhecimento de fim de linha |
| 11 | Correção aplicada | Parser corrigido; conector Vercel reportado como desconectado, bloqueando a obtenção dos logs de build; documento termina aguardando reconexão |

---

## 4. Matriz Temática (padrão `synthesis_agent`)

| Tema | Força da evidência | Síntese |
|---|---|---|
| Segurança de segredos | **Crítica — confirmada em produção** | Segredo `<CRON_SECRET_REDACTED — valor real presente em route.ts/page.tsx, considerar comprometido>` embutido tanto no client-side (`page.tsx`) quanto na rota (`route.ts`), em query string — CWE-798 (hardcoded credentials) + CWE-598 (info exposure via GET query). Documento propõe correção completa (POST + sessão + `CRON_SECRET` server-only); correção existe **apenas** na branch draft, não mesclada. |
| Conformidade LGPD | **Crítica** | 652 números de telefone coletados via scraping (Google Places/Apify) sem base legal documentada, finalidade declarada, opt-out ou prazo de retenção. Documento cita corretamente que legítimo interesse (ANPD) exige necessidade, minimização e ponderação — não é auto-aplicável a uma lista de prospecção fria. |
| Persistência de dados / arquitetura | Moderada→Forte (plano bem desenhado) | Migração de `leads.ts` estático para Postgres/Supabase com staging, RLS, deduplicação por `place_id`/telefone normalizado, fila de campanhas com idempotência — desenho tecnicamente sólido e parcialmente implementado. |
| Confiabilidade operacional do WhatsApp | Forte (risco real observado) | A trava `.slice(0,2)` foi corretamente identificada como insuficiente; o próprio histórico do documento relata um bloqueio real de rate-limit da Meta após múltiplos pareamentos em sequência, confirmando o risco na prática, não apenas em teoria. |
| Qualidade do parser CSV | Forte | Falha real e concreta (`\n+` vs `\n`) encontrada e corrigida durante a própria sessão — evidência de que a revisão por PR (em vez de execução direta) capturou um defeito que teria quebrado a importação em produção. |
| Consistência de branch/repositório | Moderada | Confusão recorrente entre `main`/`master` e entre os três repositórios (qual pasta, qual painel, qual "Cérebro") gerou vários erros operacionais reais ao longo da sessão. |

### Contradições identificadas e resolução

| Afirmação A | Afirmação B | Resolução |
|---|---|---|
| "A defesa que já criamos... `.slice(0,2)`... garante que o algoritmo da Meta veja como conversas orgânicas" (early, otimista) | Diagnóstico posterior: "O risco do bloqueio por SPAM... a trava não protege contra spam" | Resolvida no próprio documento — o diagnóstico crítico corrige a afirmação anterior. A tensão é real e foi corretamente revertida, não apenas "explicada". |
| "Build do caseirinhas-engine compilou com perfeição absoluta" | PR #1: "Deploy da Vercel falhou. Status: failure" | **[VERIFICADO]** No commit final da PR (`af4ddcd`), o check da Vercel retorna `state: success` — a falha relatada foi corrigida dentro da própria sessão (parser bug), confirmando que a autocorreção funcionou. |

---

## 5. Verificação Cruzada com o Estado Real dos Repositórios (segunda camada de análise)

Esta seção é o resultado da "análise aprofundada" exigida pela tarefa: uma segunda passada que não se limita a reler o texto, mas verifica cada afirmação de execução contra a realidade atual dos sistemas.

**Confirmado [VERIFICADO]:**
- PR #1 existe, está **aberta em modo draft**, título "security: migrate Caseirinhas Engine to protected Supabase staging" — https://github.com/Gaulnews/caseirinhas-engine/pull/1
- Branch `security/supabase-campaign-architecture` existe no remoto, com 7 commits reais (`e3dc534`→`af4ddcd`), diff de **13 arquivos, +360/−4244 linhas** vs. `master`
- `src/data/leads.ts` (3.921 linhas) e `importar_leads.js` foram de fato removidos **nessa branch**
- O bug do parser (`\n+`) foi corrigido no commit `af4ddcd` ("fix: avoid newline literals in CSV parser source")
- O deploy Vercel do commit mais recente da PR retorna **`state: success`** — o bloqueio relatado no fim do documento já foi superado desde então

**Achados críticos ainda ativos [VERIFICADO] — não mencionados como resolvidos no documento:**

1. **O segredo hardcoded continua ativo em `master` (produção)**: `src/app/api/cron/route.ts` linha 11 e `src/app/page.tsx` linha 48 ainda contêm `<CRON_SECRET_REDACTED — valor real presente em route.ts/page.tsx, considerar comprometido>` em texto puro, inclusive no bundle client-side. A correção existe somente na branch draft, nunca mesclada.
2. **652 números de telefone pessoais seguem versionados publicamente**: `src/data/leads.ts` (90.530 bytes) está presente em `master` e no histórico do Git nos commits `e44fc6d` e `10b9a39`. O próprio documento alerta que "remover o arquivo da branch não remove conteúdo de commits históricos" — essa reescrita de histórico **nunca foi executada**, nem na branch de segurança nem em `master`.
3. **A PR de correção nunca foi mesclada**: toda a superfície de risco (segredo exposto, dados pessoais no bundle, rota `/api/cron` pública) permanece live em produção, pois `master` é o branch de deploy.
4. **`caseirinhas-wpp/.gitignore` não recebeu a atualização prometida**: o documento (Etapa 2, "Blindagem do Motor") instrui adicionar `sessao_segura_tata/` ao `.gitignore`. O arquivo real hoje contém apenas `node_modules/`, `auth_info_baileys/` e `.env` — a pasta de sessão nova **não está protegida**, criando risco de a sessão criptografada do WhatsApp ser versionada acidentalmente.
5. **RBAC/Supabase Auth não implementado**: a PR usa apenas um `ADMIN_API_TOKEN` estático temporário, como o próprio documento reconhece ("substituindo o token administrativo temporário").

---

## 6. Devil's Advocate Checkpoint (padrão `devils_advocate_agent`)

### Verdict: **REVISE**

### Issues Críticos (bloqueiam a conclusão de que "o problema foi resolvido")

1. **Correção existe apenas em rascunho, não em produção**
   - Tipo: Gestão de risco / Deploy
   - Localização: `master` branch, arquivos `route.ts` e `page.tsx`
   - Problema: todo o diagnóstico e desenho de correção do documento é tecnicamente correto, mas **nada disso protege o sistema hoje** — `master` é o que está implantado.
   - Impacto: o segredo e os 652 telefones continuam expostos publicamente enquanto a PR permanece em draft.
   - Recomendação: tratar o merge da PR #1 (após os testes sintéticos previstos) como ação de prioridade máxima, não como item de backlog.

2. **Exposição histórica não tratada**
   - Tipo: Segurança / Dados pessoais
   - Localização: histórico do Git em `master`, commits `e44fc6d`/`10b9a39`
   - Problema: mesmo após um eventual merge, os 652 telefones continuam recuperáveis via `git log`/clone público, pois remover um arquivo em um commit novo não apaga commits antigos.
   - Recomendação: avaliar `git filter-repo` ou BFG Repo-Cleaner, considerar o repositório como comprometido para fins de LGPD, e notificar/rotacionar conforme necessário.

3. **`.gitignore` do `caseirinhas-wpp` incompleto**
   - Tipo: Configuração / Segurança operacional
   - Problema: a nova pasta `sessao_segura_tata/` não está ignorada; um `git add` amplo nesse repositório pode versionar credenciais de sessão do WhatsApp.
   - Recomendação: aplicar a correção de uma linha (`echo "sessao_segura_tata/" >> .gitignore`) imediatamente — é a correção mais barata identificada nesta análise e ainda não foi feita.

### Issues Maiores

- Falta de RBAC real (apenas token estático) — aceitável como etapa intermediária, mas não deve ser tratado como estado final.
- Ausência de política formal de retenção/base legal documentada para os 652 leads — a importação para staging não substitui a avaliação de conformidade.
- Nenhum teste automatizado (unit/integration/e2e) foi criado apesar da pasta `tests/` estar prevista na estrutura-alvo.

### Observações
- A disciplina de usar PR draft + checklist de segurança para revisar antes de testar CSV real foi uma boa prática, e capturou um bug real (parser) que teria quebrado a produção — isso valida o processo, não apenas o código.
- O documento é tecnicamente coerente e progressivamente mais rigoroso ao longo da conversa (da euforia inicial "máquina de vendas" ao diagnóstico crítico completo) — não há evidência de cherry-picking ou viés de confirmação na autoavaliação.

### Contra-argumento mais forte
"Nenhuma mensagem foi disparada desde o diagnóstico, então o dano real é zero." — Falso como defesa completa: a exposição de dados pessoais (LGPD) e do segredo (segurança) já constitui risco e potencial violação **independentemente de disparo de mensagens** — o repositório é público e o `master` está implantado.

### Stress Test

| Teste | Resultado |
|---|---|
| Remover a branch de correção — o problema original persiste? | Sim — `master` nunca foi corrigido |
| Inverter a pergunta: "o plano de arquitetura está certo?" | Sim, o desenho (Supabase + RLS + fila + auditoria) é sólido e alinhado a boas práticas |
| Aplicar a outro contexto: geraria o mesmo achado em qualquer repo com segredo em query string client-side? | Sim, é uma falha estrutural, não específica deste projeto |
| "E daí?" — a severidade é justificada? | Sim — dado pessoal (telefone) + credencial ativa expostos publicamente em produção |

---

## 7. Lista Completa de Conhecimento Extraído (INSIGHTs memorizados)

1. **[INSIGHT]** O sistema é composto por 3 repositórios com papéis distintos e nomenclatura própria no discurso do usuário: `caseirinhas-tata-next` = "Vitrine/SEO", `caseirinhas-engine` = "Cérebro/CRM" (Vercel), `caseirinhas-wpp` = "Motor" (Render, Baileys).
2. **[INSIGHT]** O identificador estável correto para deduplicação de leads é o `place_id` do Google Places, não a posição no array (`google_${index}`), que muda a cada importação.
3. **[INSIGHT]** A normalização de telefone deve ser E.164 (`+5543999821401`), não apenas remoção de caracteres não numéricos — o script original permitia ambiguidade entre formatos nacional/internacional.
4. **[INSIGHT]** O rate-limit de pareamento do WhatsApp/Meta é real e foi observado na prática nesta sessão — múltiplos códigos gerados em sequência acionaram bloqueio temporário, exigindo um "Protocolo de Resfriamento" de 4–8h.
5. **[INSIGHT]** A sessão do Baileys em `sessao_segura_tata/` no Render é potencialmente efêmera (filesystem local de PaaS gratuito) — "Clear build cache & deploy" pode apagar justamente o estado que permitiria reconexão automática.
6. **[INSIGHT]** O segredo `<CRON_SECRET_REDACTED — valor real presente em route.ts/page.tsx, considerar comprometido>` foi tratado no documento como "deve ser considerado comprometido" — decisão correta, pois esteve em código-fonte público e em query string.
7. **[INSIGHT]** A regra de elegibilidade de um lead para campanha, no schema proposto, exige simultaneamente: `status = 'eligible'`, ausência em `opt_outs`, e não contatado nos últimos 30 dias — este último é uma política de produto, não uma garantia de conformidade.
8. **[INSIGHT]** O bug do parser CSV (`char === '\n+'`) é do tipo "erro de digitação com impacto funcional total" — não lançava exceção, apenas silenciosamente falhava em reconhecer quebras de linha, o tipo de defeito mais perigoso por não ser autoevidente.
9. **[INSIGHT]** A decisão de não reutilizar o projeto Supabase "Formulário" (inativo, propósito não confirmado) e criar um projeto dedicado (`caseirinhas-engine-staging`, `sa-east-1`) segue corretamente o princípio de isolamento de dados sensíveis.
10. **[INSIGHT]** RLS habilitado sem policies ("RLS Enabled No Policy") é comportamento **intencional e seguro** durante a migração — bloqueia acesso por padrão até que policies explícitas sejam definidas, e não deve ser "corrigido" adicionando policies amplas apressadamente.

---

## 8. Lacunas de Conhecimento (o que o documento não informa)

- Não há evidência, no texto, de qual é a base legal formalmente documentada (se houver) para o tratamento dos 652 contatos — apenas a intenção de avaliá-la.
- Não é mencionado se haverá migração futura para a API oficial do WhatsApp Business (Cloud API), o que eliminaria boa parte do risco de bloqueio inerente ao uso do Baileys (biblioteca não oficial).
- O custo real do projeto Supabase dedicado não é revelado no texto (a IA afirma que consultaria, mas a resposta não está no documento).
- Não há registro de quem, na organização, é responsável pela decisão de conformidade LGPD (papel de encarregado/DPO).

---

## 9. Recomendações Priorizadas para Ações Futuras

1. **Imediato / custo mínimo**: adicionar `sessao_segura_tata/` ao `.gitignore` do `caseirinhas-wpp` — correção de uma linha, ainda pendente.
2. **Urgente**: revogar/rotacionar `<CRON_SECRET_REDACTED — valor real presente em route.ts/page.tsx, considerar comprometido>` e remover seu uso client-side em `master`, independentemente do andamento da PR #1.
3. **Urgente**: avançar a PR #1 (`security/supabase-campaign-architecture`) até o merge, seguindo o checklist já definido nela (teste sintético de CSV antes do dataset real).
4. **Alta prioridade**: avaliar reescrita de histórico do Git ou tratar o repositório como definitivamente exposto para fins de LGPD, documentando a decisão.
5. **Média prioridade**: implementar Supabase Auth com papéis (`owner`/`operator`/`viewer`) substituindo o `ADMIN_API_TOKEN` estático.
6. **Média prioridade**: documentar formalmente base legal, finalidade e política de retenção antes de promover qualquer lead de `pending_review` para `eligible`.

---

## 10. Limitações desta Análise

- A análise depende da fidelidade do documento-fonte para os trechos não verificáveis via GitHub (ex.: diálogos sobre custo do Supabase, status exato do Render/WhatsApp no momento da conversa).
- A verificação cruzada foi feita em 2026-08-09 e reflete o estado dos repositórios nesse momento; mudanças posteriores não estão refletidas aqui.
- Não foi realizada varredura de segredos no histórico completo do Git (apenas confirmação pontual da presença do arquivo/segredo nos commits identificados no próprio documento).

---

## 11. Referências

- Documento-fonte: sessão Perplexity "Garoto de programa" (anexo à tarefa TAREFA-ANALISE-01)
- `https://github.com/Gaulnews/caseirinhas-engine` — branches `master`, `security/supabase-campaign-architecture`; PR #1
- `https://github.com/Gaulnews/caseirinhas-wpp` — `.gitignore` (verificado 2026-08-09)
- `https://github.com/Gaulnews/caseirinhas-tata-next`
- Estrutura de análise padrão: `SKILL.md` (deep-research v2.11.0), `research_architect_agent.md`, `synthesis_agent.md`, `report_compiler_agent.md`, `socratic_mentor_agent.md`, `devils_advocate_agent.md`

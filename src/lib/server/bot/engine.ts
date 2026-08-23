import {
  getSession, upsertSession, deleteSession,
  getProducts, getDailySpecial, upsertCustomer, createOrder,
  ensureNotProcessed,
  BotState, CartItem, SessionContext,
} from './db';
import { sendBotText } from './sender';

const BUSINESS = process.env.WAB_BUSINESS_NAME ?? 'Caseirinhas da Tatá';
const SLACK_URL = process.env.WAB_SLACK_WEBHOOK_URL ?? '';

const DAY_PT = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const PAYMENT: Record<string, string> = { '1': 'Pix', '2': 'Dinheiro', '3': 'Cartão' };

function brl(v: number) { return `R$ ${v.toFixed(2).replace('.', ',')}` }

function n(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

async function say(instance: string, phone: string, text: string) {
  await sendBotText(instance, phone, text);
}

async function slack(text: string) {
  if (!SLACK_URL) return;
  await fetch(SLACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(() => {});
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function handleMessage(
  instance: string,
  phone: string,
  pushName: string,
  messageId: string,
  text: string,
) {
  const isNew = await ensureNotProcessed(messageId);
  if (!isNew) return;

  const t = n(text);

  // ── Global triggers (work in any state) ─────────────────────────────────────
  if (['menu', 'inicio', 'oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'start'].includes(t)) {
    const customer = await upsertCustomer(phone, pushName);
    await showWelcome(instance, phone, customer?.name ?? pushName);
    return;
  }

  if (t === 'atendente' || t === '4') {
    await upsertSession(phone, 'HANDOFF', {});
    await say(instance, phone,
      `👤 Certo! Um atendente foi notificado e entrará em contato em breve.\n\nEscreva *menu* quando quiser retomar o pedido. 😊`,
    );
    await slack(`🔔 *Atendimento solicitado*\nNúmero: ${phone}\nMensagem: "${text.slice(0, 100)}"`);
    return;
  }

  const session = await getSession(phone);
  const state: BotState = session?.state ?? 'MENU';
  const ctx: SessionContext = session?.context ?? {};

  // ── HANDOFF: relay to Slack, don't auto-reply ────────────────────────────────
  if (state === 'HANDOFF') {
    await slack(`💬 *Atendimento humano*\nNúmero: ${phone}\n"${text.slice(0, 200)}"`);
    return;
  }

  // ── MENU / first message ─────────────────────────────────────────────────────
  if (state === 'MENU' || !session) {
    const customer = await upsertCustomer(phone, pushName);
    const base: SessionContext = { customerName: customer?.name ?? pushName, cart: [] };

    if (t === '1') {
      const products = await getProducts();
      const lines = products.map((p, i) => `*${i + 1}* – ${p.name}  ${brl(p.price)}`).join('\n');
      await say(instance, phone, `📋 *Cardápio – ${BUSINESS}*\n\n${lines}\n\nEscreva *2* para fazer seu pedido.`);
      await upsertSession(phone, 'MENU', base);
      return;
    }

    if (t === '2') {
      await startOrdering(instance, phone, base);
      return;
    }

    if (t === '3') {
      await say(instance, phone, `📦 Acompanhe seu pedido pelo nosso grupo VIP ou aguarde nossa mensagem de atualização.`);
      await upsertSession(phone, 'MENU', base);
      return;
    }

    await showWelcome(instance, phone, customer?.name ?? pushName);
    return;
  }

  // ── ORDERING ─────────────────────────────────────────────────────────────────
  if (state === 'ORDERING') {
    await handleOrdering(instance, phone, t, text, ctx);
    return;
  }

  // ── CHECKOUT_ADDRESS ─────────────────────────────────────────────────────────
  if (state === 'CHECKOUT_ADDRESS') {
    const address = t === 'retirada' ? 'Retirada no local' : text.trim();
    await say(instance, phone, `💳 *Forma de pagamento:*\n\n*1* – Pix\n*2* – Dinheiro\n*3* – Cartão`);
    await upsertSession(phone, 'CHECKOUT_PAYMENT', { ...ctx, address });
    return;
  }

  // ── CHECKOUT_PAYMENT ─────────────────────────────────────────────────────────
  if (state === 'CHECKOUT_PAYMENT') {
    const method = PAYMENT[t];
    if (!method) {
      await say(instance, phone, `❓ Escolha: *1* Pix  |  *2* Dinheiro  |  *3* Cartão`);
      return;
    }
    const newCtx = { ...ctx, paymentMethod: method };
    await showSummary(instance, phone, newCtx);
    await upsertSession(phone, 'CONFIRM', newCtx);
    return;
  }

  // ── CONFIRM ───────────────────────────────────────────────────────────────────
  if (state === 'CONFIRM') {
    if (['nao', 'nop', 'n', 'cancelar', 'no'].includes(t)) {
      await deleteSession(phone);
      await say(instance, phone, `❌ Pedido cancelado. Escreva *menu* para começar novamente. 😊`);
      return;
    }
    if (['sim', 's', 'confirmar', 'ok', 'yes', 'confirmo'].includes(t)) {
      await finalizeOrder(instance, phone, ctx);
      return;
    }
    await say(instance, phone, `❓ Responda *sim* para confirmar ou *não* para cancelar.`);
    return;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function showWelcome(instance: string, phone: string, name: string) {
  const special = await getDailySpecial();
  const nowSP = new Date(Date.now() - 3 * 3600_000);
  const hour = nowSP.getUTCHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  let specialLine = '';
  if (special) {
    specialLine = `\n\n🍱 *Prato de ${DAY_PT[nowSP.getUTCDay()]}:* ${special.name}\n_${special.description}_`;
  }

  await say(instance, phone,
    `${greeting}, ${name}! Bem-vindo(a) à *${BUSINESS}* 🍱${specialLine}\n\n` +
    `*1* – Ver cardápio\n` +
    `*2* – Fazer pedido\n` +
    `*3* – Acompanhar pedido\n` +
    `*4* – Falar com atendente`,
  );
  await upsertSession(phone, 'MENU', { customerName: name, cart: [] });
}

async function startOrdering(instance: string, phone: string, ctx: SessionContext) {
  const products = await getProducts();
  if (products.length === 0) {
    await say(instance, phone, `⚠️ Cardápio temporariamente indisponível. Tente novamente em instantes.`);
    return;
  }
  const lines = products.map((p, i) => `*${i + 1}* – ${p.name}  ${brl(p.price)}`).join('\n');
  await say(instance, phone,
    `🛒 *Cardápio – ${BUSINESS}*\n\n${lines}\n\n` +
    `Digite o número do item (ex: *1*).\n` +
    `Para 2 unidades escreva *2x 1*.\n` +
    `Quando terminar escreva *finalizar*.`,
  );
  await upsertSession(phone, 'ORDERING', { ...ctx, cart: [] });
}

async function handleOrdering(
  instance: string,
  phone: string,
  t: string,
  raw: string,
  ctx: SessionContext,
) {
  const cart: CartItem[] = ctx.cart ?? [];

  if (['finalizar', 'pronto', 'ok', 'feito'].includes(t)) {
    if (cart.length === 0) {
      await say(instance, phone, `🛒 Carrinho vazio! Digite o número de um item para adicioná-lo.`);
      return;
    }
    const total = cart.reduce((s, i) => s + i.qty * i.unit_price, 0);
    const lines = cart.map((i) => `• ${i.qty}x ${i.name}  ${brl(i.qty * i.unit_price)}`).join('\n');
    await say(instance, phone,
      `🛒 *Carrinho*\n\n${lines}\n*Total: ${brl(total)}*\n\n` +
      `Qual o endereço de entrega?\n_(ou escreva *retirada* para buscar no local)_`,
    );
    await upsertSession(phone, 'CHECKOUT_ADDRESS', { ...ctx, cart });
    return;
  }

  // Parse "2x 1", "2x1", or simply "1"
  const qtyItem = t.match(/^(\d+)x\s*(\d+)$/);
  const simple = t.match(/^(\d+)$/);
  let qty = 1;
  let idx = -1;

  if (qtyItem) {
    qty = Math.min(parseInt(qtyItem[1]), 20);
    idx = parseInt(qtyItem[2]) - 1;
  } else if (simple) {
    idx = parseInt(simple[1]) - 1;
  }

  if (idx < 0) {
    await say(instance, phone, `❓ Digite o número do item ou *finalizar* para concluir o pedido.`);
    return;
  }

  const products = await getProducts();
  if (idx >= products.length) {
    await say(instance, phone, `❓ Item inválido. Escolha entre 1 e ${products.length}.`);
    return;
  }

  const product = products[idx];
  const existing = cart.find((i) => i.product_id === product.id);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({ product_id: product.id, name: product.name, qty, unit_price: product.price });
  }

  const total = cart.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const lines = cart.map((i) => `• ${i.qty}x ${i.name}  ${brl(i.qty * i.unit_price)}`).join('\n');
  await say(instance, phone,
    `✅ *${qty}x ${product.name}* adicionada!\n\n🛒 *Carrinho:*\n${lines}\n*Subtotal: ${brl(total)}*\n\n` +
    `Adicione mais ou escreva *finalizar*.`,
  );
  await upsertSession(phone, 'ORDERING', { ...ctx, cart });
  void raw; // raw text kept for potential future use
}

async function showSummary(instance: string, phone: string, ctx: SessionContext) {
  const cart = ctx.cart ?? [];
  const total = cart.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const lines = cart.map((i) => `• ${i.qty}x ${i.name}  ${brl(i.qty * i.unit_price)}`).join('\n');
  await say(instance, phone,
    `📋 *Confirmação do pedido*\n\n${lines}\n\n` +
    `📍 *Entrega:* ${ctx.address}\n` +
    `💳 *Pagamento:* ${ctx.paymentMethod}\n` +
    `💰 *Total: ${brl(total)}*\n\n` +
    `Confirma? Escreva *sim* ou *não*.`,
  );
}

async function finalizeOrder(instance: string, phone: string, ctx: SessionContext) {
  const customer = await upsertCustomer(phone, ctx.customerName);
  if (!customer) {
    await say(instance, phone, `⚠️ Erro ao registrar cliente. Escreva *atendente* para obter ajuda.`);
    return;
  }

  const orderId = await createOrder(
    customer.id,
    ctx.cart ?? [],
    ctx.address ?? 'Não informado',
    ctx.paymentMethod ?? 'Não informado',
  );

  if (!orderId) {
    await say(instance, phone, `⚠️ Erro ao registrar pedido. Escreva *atendente* para obter ajuda.`);
    return;
  }

  const total = (ctx.cart ?? []).reduce((s, i) => s + i.qty * i.unit_price, 0);
  const itemsSummary = (ctx.cart ?? []).map((i) => `${i.qty}x ${i.name}`).join(', ');

  await say(instance, phone,
    `✅ *Pedido #${orderId} confirmado!*\n\n` +
    `Obrigado, ${ctx.customerName ?? 'cliente'}! Seu pedido está sendo preparado com carinho. 🍱\n\n` +
    `*Total:* ${brl(total)}\n` +
    `*Pagamento:* ${ctx.paymentMethod}\n\n` +
    `Em breve você receberá uma atualização. Bom apetite! 😋`,
  );

  await slack(
    `🛒 *Novo pedido #${orderId} – ${BUSINESS}*\n` +
    `Cliente: ${ctx.customerName ?? '-'} (${phone})\n` +
    `Itens: ${itemsSummary}\n` +
    `Total: ${brl(total)}\n` +
    `Entrega: ${ctx.address}\n` +
    `Pagamento: ${ctx.paymentMethod}`,
  );

  await deleteSession(phone);
}

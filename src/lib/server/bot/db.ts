import { supabaseRest } from '../supabase-rest';

async function parseJson<T>(res: Response): Promise<T | null> {
  const text = await res.text().catch(() => '');
  try { return JSON.parse(text) as T; } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type BotState =
  | 'MENU'
  | 'ORDERING'
  | 'CHECKOUT_ADDRESS'
  | 'CHECKOUT_PAYMENT'
  | 'CONFIRM'
  | 'HANDOFF';

export type CartItem = {
  product_id: string;
  name: string;
  qty: number;
  unit_price: number;
};

export type SessionContext = {
  customerName?: string;
  cart?: CartItem[];
  address?: string;
  paymentMethod?: string;
};

export type Product = { id: string; name: string; price: number };
export type DailySpecial = { day_of_week: number; name: string; description: string };

// ── Session ───────────────────────────────────────────────────────────────────

const TTL_MIN = 30;

export async function getSession(
  phone: string,
): Promise<{ state: BotState; context: SessionContext } | null> {
  const res = await supabaseRest(
    `wab_bot_sessions?phone=eq.${encodeURIComponent(phone)}` +
    `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
    `&limit=1`,
  );
  if (!res.ok) return null;
  const rows = await parseJson<Array<{ state: BotState; context: SessionContext }>>(res);
  return rows?.[0] ?? null;
}

export async function upsertSession(
  phone: string,
  state: BotState,
  context: SessionContext,
): Promise<void> {
  const expires_at = new Date(Date.now() + TTL_MIN * 60_000).toISOString();
  await supabaseRest('wab_bot_sessions?on_conflict=phone', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ phone, state, context, expires_at }),
  });
}

export async function deleteSession(phone: string): Promise<void> {
  await supabaseRest(
    `wab_bot_sessions?phone=eq.${encodeURIComponent(phone)}`,
    { method: 'DELETE' },
  );
}

// ── Products ──────────────────────────────────────────────────────────────────

export async function getProducts(): Promise<Product[]> {
  const res = await supabaseRest('wab_products?active=eq.true&order=price.asc');
  if (!res.ok) return [];
  return (await parseJson<Product[]>(res)) ?? [];
}

// ── Daily Special ─────────────────────────────────────────────────────────────

export async function getDailySpecial(): Promise<DailySpecial | null> {
  // São Paulo is UTC-3
  const nowSP = new Date(Date.now() - 3 * 3600_000);
  const dow = nowSP.getUTCDay();
  const res = await supabaseRest(`wab_daily_specials?day_of_week=eq.${dow}&limit=1`);
  if (!res.ok) return null;
  const rows = await parseJson<DailySpecial[]>(res);
  return rows?.[0] ?? null;
}

// ── Customer ──────────────────────────────────────────────────────────────────

export async function upsertCustomer(
  phone: string,
  name?: string,
): Promise<{ id: string; name: string } | null> {
  const payload: Record<string, string> = { phone };
  if (name) payload.name = name;
  const res = await supabaseRest('wab_customers?on_conflict=phone', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return null;
  const rows = await parseJson<Array<{ id: string; name: string }>>(res);
  return rows?.[0] ?? null;
}

// ── Order ─────────────────────────────────────────────────────────────────────

export async function createOrder(
  customerId: string,
  items: CartItem[],
  address: string,
  paymentMethod: string,
): Promise<number | null> {
  const total = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const orderRes = await supabaseRest('wab_orders', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ customer_id: customerId, status: 'pending', total, payment_method: paymentMethod, address }),
  });
  if (!orderRes.ok) return null;
  const orders = await parseJson<Array<{ id: number }>>(orderRes);
  const orderId = orders?.[0]?.id;
  if (!orderId) return null;

  await supabaseRest('wab_order_items', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(
      items.map((i) => ({
        order_id: orderId,
        product_id: i.product_id,
        qty: i.qty,
        unit_price: i.unit_price,
      })),
    ),
  });

  return orderId;
}

// ── Idempotency ───────────────────────────────────────────────────────────────

export async function ensureNotProcessed(messageId: string): Promise<boolean> {
  const res = await supabaseRest('wab_processed_events?on_conflict=message_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ message_id: messageId }),
  });
  if (!res.ok) return false;
  // Empty array = duplicate (ignored); non-empty = newly inserted
  const rows = await parseJson<unknown[]>(res);
  return Array.isArray(rows) && rows.length > 0;
}

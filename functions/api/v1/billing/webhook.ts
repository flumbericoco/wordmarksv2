interface Env { DB: D1Database; STRIPE_WEBHOOK_SECRET?: string }

const monthlyCredits: Record<string, number> = { lite: 1, growth: 4, pro: 10, scale: 28 };
const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifySignature(raw: string, header: string, secret: string): Promise<boolean> {
  const values = Object.fromEntries(header.split(',').map((part) => part.split('=', 2)));
  const timestamp = Number(values.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !values.v1) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${raw}`)));
  if (signature.length !== values.v1.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) mismatch |= signature.charCodeAt(i) ^ values.v1.charCodeAt(i);
  return mismatch === 0;
}

async function addCredits(db: D1Database, userId: string, amount: number, reason: string, reference: string) {
  const inserted = await db.prepare('INSERT OR IGNORE INTO credit_ledger (id, user_id, amount, reason, reference) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, amount, reason, reference).run();
  if (inserted.meta.changes) {
    await db.prepare("UPDATE users SET credits = credits + ?, updated_at = datetime('now') WHERE id = ?").bind(amount, userId).run();
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const raw = await request.text();
  const signature = request.headers.get('Stripe-Signature') || '';
  if (!env.STRIPE_WEBHOOK_SECRET || !await verifySignature(raw, signature, env.STRIPE_WEBHOOK_SECRET)) {
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }
  const event = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };
  const object = event.data.object;

  if (event.type === 'checkout.session.completed') {
    const metadata = object.metadata as Record<string, string> | undefined;
    const userId = metadata?.user_id;
    const plan = metadata?.plan;
    const paymentStatus = String(object.payment_status || '');
    if (userId && plan && paymentStatus === 'paid') {
      await addCredits(env.DB, userId, 25, 'initial_credit_pack', `checkout:${String(object.id)}`);
      await env.DB.prepare("UPDATE users SET plan = ?, stripe_customer_id = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(plan, String(object.customer || ''), userId).run();
      await env.DB.prepare(
        `INSERT INTO subscriptions (id, user_id, stripe_subscription_id, plan, status)
         VALUES (?, ?, ?, ?, 'active')
         ON CONFLICT(stripe_subscription_id) DO UPDATE SET plan=excluded.plan, status='active', updated_at=datetime('now')`
      ).bind(crypto.randomUUID(), userId, String(object.subscription || ''), plan).run();
    }
  }

  if (event.type === 'invoice.payment_succeeded' && object.billing_reason === 'subscription_cycle') {
    const parent = object.parent as Record<string, unknown> | undefined;
    const details = parent?.subscription_details as Record<string, unknown> | undefined;
    const subscriptionId = String(object.subscription || details?.subscription || '');
    const subscription = await env.DB.prepare('SELECT user_id, plan FROM subscriptions WHERE stripe_subscription_id = ?').bind(subscriptionId).first<Record<string, unknown>>();
    if (subscription) {
      const plan = String(subscription.plan);
      await addCredits(env.DB, String(subscription.user_id), monthlyCredits[plan] || 0, 'monthly_renewal', `invoice:${String(object.id)}`);
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const parent = object.parent as Record<string, unknown> | undefined;
    const details = parent?.subscription_details as Record<string, unknown> | undefined;
    const subscriptionId = String(object.subscription || details?.subscription || '');
    if (subscriptionId) {
      await env.DB.prepare("UPDATE subscriptions SET status='past_due', updated_at=datetime('now') WHERE stripe_subscription_id = ?")
        .bind(subscriptionId).run();
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    await env.DB.prepare("UPDATE subscriptions SET status='cancelled', updated_at=datetime('now') WHERE stripe_subscription_id = ?")
      .bind(String(object.id)).run();
  }

  return Response.json({ received: true });
};

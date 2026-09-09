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
  try {
    await db.batch([
      db.prepare('INSERT INTO credit_ledger (id, user_id, amount, reason, reference) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), userId, amount, reason, reference),
      db.prepare("UPDATE users SET credits = credits + ?, updated_at = datetime('now') WHERE id = ?").bind(amount, userId),
    ]);
  } catch (error) {
    // A unique reference means this exact benefit was already granted atomically.
    const existing = await db.prepare('SELECT id FROM credit_ledger WHERE reference = ?').bind(reference).first();
    if (!existing) throw error;
  }
}

async function revokeAvailableCredits(db: D1Database, userId: string, requested: number, reason: string, reference: string) {
  const row = await db.prepare('SELECT credits FROM users WHERE id=?').bind(userId).first<{ credits: number }>();
  const amount = Math.min(Math.max(Number(row?.credits || 0), 0), requested);
  if (!amount) return;
  await db.batch([
    db.prepare("UPDATE users SET credits=credits-?, updated_at=datetime('now') WHERE id=? AND credits>=?").bind(amount, userId, amount),
    db.prepare('INSERT INTO credit_ledger (id,user_id,amount,reason,reference) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(), userId, -amount, reason, reference),
  ]);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const raw = await request.text();
  const signature = request.headers.get('Stripe-Signature') || '';
  if (!env.STRIPE_WEBHOOK_SECRET || !await verifySignature(raw, signature, env.STRIPE_WEBHOOK_SECRET)) {
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }
  const event = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };
  const object = event.data.object;

  let claimed = await env.DB.prepare(
    "INSERT OR IGNORE INTO payment_events (event_id, event_type, status) VALUES (?, ?, 'processing')"
  ).bind(event.id, event.type).run();
  if (!claimed.meta.changes) {
    const previous = await env.DB.prepare('SELECT status FROM payment_events WHERE event_id=?').bind(event.id).first<{ status: string }>();
    if (previous?.status === 'processed' || previous?.status === 'processing') {
      return Response.json({ received: true, duplicate: true });
    }
    claimed = await env.DB.prepare("UPDATE payment_events SET status='processing', error=NULL WHERE event_id=? AND status='failed'")
      .bind(event.id).run();
    if (!claimed.meta.changes) return Response.json({ received: true, duplicate: true });
  }

  try {

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const metadata = object.metadata as Record<string, string> | undefined;
    const userId = metadata?.user_id;
    const plan = metadata?.plan;
    const kind = metadata?.kind;
    const paymentStatus = String(object.payment_status || '');
    if (userId && kind === 'topup' && paymentStatus === 'paid') {
      await addCredits(env.DB, userId, 25, 'credit_topup', `checkout:${String(object.id)}`);
      await env.DB.prepare(`INSERT INTO payment_transactions(id,user_id,stripe_checkout_id,stripe_payment_intent_id,kind,amount,currency,credits,status) VALUES (?,?,?,?,?,?,?,?, 'paid') ON CONFLICT(stripe_checkout_id) DO UPDATE SET status='paid',updated_at=datetime('now')`)
        .bind(crypto.randomUUID(),userId,String(object.id),String(object.payment_intent||''),'topup',Number(object.amount_total||0),String(object.currency||'usd'),25).run();
    }
    if (userId && plan && paymentStatus === 'paid') {
      await addCredits(env.DB, userId, 25, 'initial_credit_pack', `checkout:${String(object.id)}`);
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET plan = ?, stripe_customer_id = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(plan, String(object.customer || ''), userId),
        env.DB.prepare(
          `INSERT INTO subscriptions (id, user_id, stripe_subscription_id, plan, status)
           VALUES (?, ?, ?, ?, 'trialing')
           ON CONFLICT(stripe_subscription_id) DO UPDATE SET plan=excluded.plan, status='trialing', updated_at=datetime('now')`
        ).bind(crypto.randomUUID(), userId, String(object.subscription || ''), plan),
        env.DB.prepare(
          `INSERT INTO payment_transactions
           (id,user_id,stripe_checkout_id,stripe_payment_intent_id,kind,amount,currency,credits,status)
           VALUES (?,?,?,?,?,?,?,?, 'paid')
           ON CONFLICT(stripe_checkout_id) DO UPDATE SET status='paid', updated_at=datetime('now')`
        ).bind(crypto.randomUUID(), userId, String(object.id), String(object.payment_intent || ''), 'initial_pack', Number(object.amount_total || 0), String(object.currency || 'usd'), 25),
      ]);
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
      await env.DB.prepare(
        `INSERT OR IGNORE INTO payment_transactions
         (id,user_id,stripe_invoice_id,kind,amount,currency,credits,status) VALUES (?,?,?,?,?,?,?,'paid')`
      ).bind(crypto.randomUUID(), String(subscription.user_id), String(object.id), 'renewal', Number(object.amount_paid || 0), String(object.currency || 'usd'), monthlyCredits[plan] || 0).run();
    }
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    await env.DB.prepare("UPDATE payment_transactions SET status='failed', updated_at=datetime('now') WHERE stripe_checkout_id=?")
      .bind(String(object.id)).run();
  }

  if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
    const paymentIntent = String(object.payment_intent || '');
    const transaction = paymentIntent
      ? await env.DB.prepare('SELECT id,user_id,credits FROM payment_transactions WHERE stripe_payment_intent_id=? LIMIT 1').bind(paymentIntent).first<Record<string, unknown>>()
      : null;
    if (transaction) {
      const reason = event.type === 'charge.refunded' ? 'payment_refund' : 'payment_dispute';
      await revokeAvailableCredits(env.DB, String(transaction.user_id), Number(transaction.credits || 0), reason, `${reason}:${event.id}`);
      await env.DB.prepare("UPDATE payment_transactions SET status=?, updated_at=datetime('now') WHERE id=?")
        .bind(event.type === 'charge.refunded' ? 'refunded' : 'disputed', String(transaction.id)).run();
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
    const subscriptionId = String(object.id);
    const subscription = await env.DB.prepare('SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ?')
      .bind(subscriptionId).first<Record<string, unknown>>();
    if (subscription) {
      await env.DB.batch([
        env.DB.prepare("UPDATE subscriptions SET status='cancelled', updated_at=datetime('now') WHERE stripe_subscription_id = ?").bind(subscriptionId),
        env.DB.prepare("UPDATE users SET plan='none', updated_at=datetime('now') WHERE id = ?").bind(String(subscription.user_id)),
      ]);
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const metadata = object.metadata as Record<string, string> | undefined;
    const status = String(object.status || 'unknown');
    const plan = metadata?.plan;
    const items = object.items as { data?: Array<Record<string, unknown>> } | undefined;
    const periodEnd = object.current_period_end || items?.data?.[0]?.current_period_end || object.cancel_at;
    await env.DB.prepare(
      "UPDATE subscriptions SET status=?, current_period_end=?, updated_at=datetime('now') WHERE stripe_subscription_id=?"
    ).bind(status, periodEnd ? new Date(Number(periodEnd) * 1000).toISOString() : null, String(object.id)).run();
    if (plan && ['active', 'trialing'].includes(status)) {
      await env.DB.prepare("UPDATE users SET plan=?, updated_at=datetime('now') WHERE id=(SELECT user_id FROM subscriptions WHERE stripe_subscription_id=?)")
        .bind(plan, String(object.id)).run();
    }
  }

  await env.DB.prepare("UPDATE payment_events SET status='processed', processed_at=datetime('now') WHERE event_id=?")
    .bind(event.id).run();
  } catch (error) {
    await env.DB.prepare("UPDATE payment_events SET status='failed', error=?, processed_at=datetime('now') WHERE event_id=?")
      .bind(error instanceof Error ? error.message : String(error), event.id).run().catch(() => undefined);
    throw error;
  }

  return Response.json({ received: true });
};

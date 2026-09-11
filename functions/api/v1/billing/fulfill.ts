export interface StripeCheckoutSession {
  id?: string;
  created?: number;
  customer?: string;
  subscription?: string;
  payment_intent?: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  metadata?: Record<string, string>;
}

export async function fulfillPaidCheckout(db: D1Database, session: StripeCheckoutSession, expectedUserId: string) {
  const sessionId = String(session.id || '');
  const metadata = session.metadata || {};
  if (!sessionId || metadata.user_id !== expectedUserId) throw new Error('Checkout does not belong to this account');
  if (session.payment_status !== 'paid') return { fulfilled: false, paymentStatus: String(session.payment_status || 'unpaid') };

  const kind = metadata.kind;
  const plan = metadata.plan;
  if (kind !== 'topup' && !(kind === 'subscription' && plan)) throw new Error('Invalid checkout metadata');

  const reference = `checkout:${sessionId}`;
  const existing = await db.prepare('SELECT id FROM credit_ledger WHERE reference=?').bind(reference).first();
  if (existing) return { fulfilled: true, alreadyProcessed: true, paymentStatus: 'paid' };

  const statements = [
    db.prepare('INSERT INTO credit_ledger(id,user_id,amount,reason,reference) VALUES(?,?,?,?,?)')
      .bind(crypto.randomUUID(), expectedUserId, 25, kind === 'topup' ? 'credit_topup' : 'initial_credit_pack', reference),
    db.prepare("UPDATE users SET credits=credits+25, updated_at=datetime('now') WHERE id=?").bind(expectedUserId),
    db.prepare(`INSERT INTO payment_transactions
      (id,user_id,stripe_checkout_id,stripe_payment_intent_id,kind,amount,currency,credits,status)
      VALUES(?,?,?,?,?,?,?,?, 'paid')`)
      .bind(crypto.randomUUID(), expectedUserId, sessionId, String(session.payment_intent || ''), kind === 'topup' ? 'topup' : 'initial_pack', Number(session.amount_total || 0), String(session.currency || 'usd'), 25),
  ];

  if (kind === 'subscription' && plan) {
    statements.push(
      db.prepare("UPDATE users SET plan=?, stripe_customer_id=?, updated_at=datetime('now') WHERE id=?")
        .bind(plan, String(session.customer || ''), expectedUserId),
      db.prepare(`INSERT INTO subscriptions(id,user_id,stripe_subscription_id,plan,status)
        VALUES(?,?,?,?, 'trialing')
        ON CONFLICT(stripe_subscription_id) DO UPDATE SET plan=excluded.plan,status='trialing',updated_at=datetime('now')`)
        .bind(crypto.randomUUID(), expectedUserId, String(session.subscription || ''), plan),
    );
  }

  try {
    await db.batch(statements);
  } catch (error) {
    const duplicate = await db.prepare('SELECT id FROM credit_ledger WHERE reference=?').bind(reference).first();
    if (!duplicate) throw error;
  }
  return { fulfilled: true, alreadyProcessed: false, paymentStatus: 'paid' };
}

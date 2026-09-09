import { getUserSession } from '../user-auth';

interface Env { DB: D1Database; STRIPE_SECRET_KEY?: string }

async function stripeGet(path: string, secret: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) return null;
  return response.json<Record<string, unknown>>();
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserSession(request, env.DB);
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  const local = await env.DB.prepare(
    'SELECT stripe_subscription_id, plan, status, current_period_end, updated_at FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).bind(user.id).first<Record<string, unknown>>();

  let subscription = local ? {
    id: String(local.stripe_subscription_id || ''),
    plan: String(local.plan || user.plan),
    status: String(local.status || 'unknown'),
    currentPeriodEnd: local.current_period_end ? String(local.current_period_end) : null,
    cancelAtPeriodEnd: false,
  } : null;
  let invoices: Array<Record<string, unknown>> = [];

  if (env.STRIPE_SECRET_KEY && subscription?.id) {
    const remote = await stripeGet(`subscriptions/${encodeURIComponent(subscription.id)}`, env.STRIPE_SECRET_KEY);
    if (remote) {
      const items = remote.items as { data?: Array<Record<string, unknown>> } | undefined;
      const periodEnd = Number(remote.current_period_end || items?.data?.[0]?.current_period_end || remote.cancel_at || 0);
      subscription = {
        ...subscription,
        status: String(remote.status || subscription.status),
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : subscription.currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(remote.cancel_at_period_end || remote.cancel_at),
      };
    }
  }

  if (env.STRIPE_SECRET_KEY && user.stripeCustomerId) {
    const result = await stripeGet(`invoices?customer=${encodeURIComponent(user.stripeCustomerId)}&limit=10`, env.STRIPE_SECRET_KEY);
    const data = Array.isArray(result?.data) ? result.data as Array<Record<string, unknown>> : [];
    invoices = data.map((invoice) => ({
      id: String(invoice.id || ''),
      number: String(invoice.number || ''),
      status: String(invoice.status || ''),
      amountPaid: Number(invoice.amount_paid || 0),
      currency: String(invoice.currency || 'usd').toUpperCase(),
      createdAt: new Date(Number(invoice.created || 0) * 1000).toISOString(),
      hostedUrl: typeof invoice.hosted_invoice_url === 'string' ? invoice.hosted_invoice_url : null,
    }));
  }

  const ledger = await env.DB.prepare(
    'SELECT id, amount, reason, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(user.id).all();

  return Response.json({ ok: true, subscription, invoices, creditHistory: ledger.results || [] });
};

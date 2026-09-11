import { getUserSession } from '../user-auth';

interface Env { DB: D1Database; STRIPE_SECRET_KEY?: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserSession(request, env.DB);
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!env.STRIPE_SECRET_KEY) return Response.json({ error: 'Billing is not configured' }, { status: 503 });

  const subscription = await env.DB.prepare(
    "SELECT stripe_subscription_id FROM subscriptions WHERE user_id=? AND status IN ('active','trialing','past_due') ORDER BY updated_at DESC LIMIT 1"
  ).bind(user.id).first<{ stripe_subscription_id: string }>();
  if (!subscription?.stripe_subscription_id) {
    return Response.json({ error: 'No active subscription found' }, { status: 404 });
  }

  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscription.stripe_subscription_id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const result = await response.json<Record<string, unknown>>();
  if (!response.ok || result.status !== 'canceled') {
    const error = result.error as Record<string, unknown> | undefined;
    return Response.json({ error: String(error?.message || 'Unable to cancel subscription') }, { status: 502 });
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE subscriptions SET status='cancelled', updated_at=datetime('now') WHERE stripe_subscription_id=? AND user_id=?")
      .bind(subscription.stripe_subscription_id, user.id),
    env.DB.prepare("UPDATE users SET plan='none', updated_at=datetime('now') WHERE id=?").bind(user.id),
  ]);
  return Response.json({ ok: true, status: 'cancelled' });
};

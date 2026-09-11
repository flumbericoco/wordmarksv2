import { getUserSession } from '../user-auth';

interface Env {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_LITE?: string;
  STRIPE_PRICE_GROWTH?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_SCALE?: string;
}

const priceKeys = {
  lite: 'STRIPE_PRICE_LITE', growth: 'STRIPE_PRICE_GROWTH',
  pro: 'STRIPE_PRICE_PRO', scale: 'STRIPE_PRICE_SCALE',
} as const;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserSession(request, env.DB);
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const missingConfiguration = [!env.STRIPE_SECRET_KEY && 'STRIPE_SECRET_KEY'].filter(Boolean);
  if (missingConfiguration.length > 0) {
    return Response.json({
      error: `Billing configuration missing: ${missingConfiguration.join(', ')}`,
    }, { status: 503 });
  }
  const stripeSecretKey = env.STRIPE_SECRET_KEY as string;
  const body: { plan?: string } = await request.json<{ plan?: string }>().catch(() => ({}));
  const plan = String(body.plan || '').toLowerCase() as keyof typeof priceKeys;
  const priceKey = priceKeys[plan];
  if (!priceKey) return Response.json({ error: 'Invalid plan' }, { status: 400 });
  const priceId = env[priceKey];
  if (!priceId) {
    return Response.json({ error: `Billing configuration missing: ${priceKey}` }, { status: 503 });
  }

  const existing = await env.DB.prepare(
    "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = ? AND status IN ('active', 'trialing', 'past_due') LIMIT 1"
  ).bind(user.id).first();
  if (existing) {
    return Response.json({ error: 'You already have an active subscription. Manage it from the billing portal.' }, { status: 409 });
  }

  const origin = new URL(request.url).origin;
  const form = new URLSearchParams({
    mode: 'subscription',
    success_url: `${origin}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/account?checkout=cancelled`,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'metadata[user_id]': user.id,
    'metadata[plan]': plan,
    'metadata[kind]': 'subscription',
    'subscription_data[metadata][user_id]': user.id,
    'subscription_data[metadata][plan]': plan,
  });
  if (user.stripeCustomerId) form.set('customer', user.stripeCustomerId);
  else form.set('customer_email', user.email);

  const stripe = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Prevent double-clicks/retries from creating multiple Stripe subscriptions.
      'Idempotency-Key': `checkout-${user.id}-${plan}-${Math.floor(Date.now() / 600_000)}`,
    },
    body: form,
  });
  const session = await stripe.json<Record<string, unknown>>();
  if (!stripe.ok || !session.url) {
    const error = session.error as Record<string, unknown> | undefined;
    return Response.json({ error: String(error?.message || 'Unable to create checkout') }, { status: 502 });
  }
  return Response.json({ ok: true, url: session.url });
};

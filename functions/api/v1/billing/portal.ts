import { getUserSession } from '../user-auth';

interface Env { DB: D1Database; STRIPE_SECRET_KEY?: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserSession(request, env.DB);
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!env.STRIPE_SECRET_KEY) return Response.json({ error: 'Billing is not configured' }, { status: 503 });
  if (!user.stripeCustomerId) return Response.json({ error: 'No active billing account yet' }, { status: 400 });

  const origin = new URL(request.url).origin;
  const form = new URLSearchParams({ customer: user.stripeCustomerId, return_url: `${origin}/account` });
  const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const result = await response.json<Record<string, unknown>>();
  if (!response.ok || !result.url) {
    const error = result.error as Record<string, unknown> | undefined;
    return Response.json({ error: String(error?.message || 'Unable to open billing portal') }, { status: 502 });
  }
  return Response.json({ ok: true, url: result.url });
};

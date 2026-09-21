import { getUserSession } from '../user-auth';
import { createPayPalOrder, PayPalProductKey, PAYPAL_PRODUCTS } from '../../../lib/paypal';

interface Env {
  DB: D1Database;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_MODE?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getUserSession(request, env.DB);
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rawBody = await request.json().catch(() => ({}));
  const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<string, unknown>;
  const rawKey = String(body.product || body.plan || 'topup').toLowerCase();

  const productKey: PayPalProductKey = (rawKey in PAYPAL_PRODUCTS)
    ? (rawKey as PayPalProductKey)
    : 'topup';

  try {
    const origin = new URL(request.url).origin;
    const result = await createPayPalOrder(env.DB, env, {
      userId: user.id,
      userEmail: user.email,
      productKey,
      origin,
    });

    return Response.json({
      ok: true,
      orderId: result.orderId,
      url: result.approveUrl,
      mode: result.mode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create PayPal order';
    return Response.json({ error: message }, { status: 500 });
  }
};

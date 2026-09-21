import { getUserSession } from '../user-auth';
import { capturePayPalOrder } from '../../../lib/paypal';

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
  const orderId = String(body.orderId || '').trim();

  if (!orderId) {
    return Response.json({ error: 'PayPal orderId is required' }, { status: 400 });
  }

  try {
    const result = await capturePayPalOrder(env.DB, env, orderId, user.id);
    return Response.json({
      ok: true,
      creditsAdded: result.creditsAdded,
      newCredits: result.newCredits,
      alreadyProcessed: result.alreadyProcessed,
      productKey: result.productKey,
      orderId: result.orderId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to capture PayPal payment';
    return Response.json({ error: message }, { status: 500 });
  }
};

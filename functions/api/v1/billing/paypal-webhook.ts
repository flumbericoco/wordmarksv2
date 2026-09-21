import { capturePayPalOrder } from '../../../lib/paypal';

interface Env {
  DB: D1Database;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_MODE?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const bodyText = await request.text();
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const eventId = String(event.id || crypto.randomUUID());
  const eventType = String(event.event_type || 'unknown');
  const resource = (event.resource || {}) as Record<string, unknown>;

  try {
    await env.DB.prepare(
      "INSERT INTO payment_events(event_id, event_type, status, created_at) VALUES(?, ?, 'processing', datetime('now')) ON CONFLICT(event_id) DO NOTHING"
    ).bind(eventId, eventType).run();

    if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      const orderId = String(resource.id || '');
      const purchaseUnits = (resource.purchase_units as Array<Record<string, unknown>>) || [];
      const customId = String(purchaseUnits[0]?.custom_id || '');
      const [userId] = customId.split(':');

      if (orderId && userId) {
        await capturePayPalOrder(env.DB, env, orderId, userId);
      }
    } else if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const customId = String(resource.custom_id || '');
      const [userId] = customId.split(':');
      const supplementaryData = resource.supplementary_data as Record<string, unknown> | undefined;
      const relatedIds = supplementaryData?.related_ids as Record<string, unknown> | undefined;
      const orderId = String(relatedIds?.order_id || resource.id || '');

      if (orderId && userId) {
        const reference = `paypal:${orderId}`;
        const existing = await env.DB.prepare('SELECT id FROM credit_ledger WHERE reference = ?').bind(reference).first();
        if (!existing) {
          await capturePayPalOrder(env.DB, env, orderId, userId);
        }
      }
    }

    await env.DB.prepare(
      "UPDATE payment_events SET status = 'processed', processed_at = datetime('now') WHERE event_id = ?"
    ).bind(eventId).run();

    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      "UPDATE payment_events SET status = 'failed', error = ?, processed_at = datetime('now') WHERE event_id = ?"
    ).bind(message, eventId).run().catch(() => null);

    return Response.json({ error: message }, { status: 500 });
  }
};

import { authenticateRequest } from '../auth';
import { UnauthorizedError, ValidationError, errorResponse, successResponse } from '../../../lib/errors';

interface Env { DB: D1Database; ADMIN_PASSWORD?: string; WORDMARKS_MCP_TOKEN?: string }

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();
  const auth = await authenticateRequest(request, env, true);
  if (!auth.isAdmin) return errorResponse(new UnauthorizedError('Admin authentication required'), requestId);
  try {
    if (request.method === 'GET') {
      const [transactions, failedEvents, users] = await Promise.all([
        env.DB.prepare(`SELECT t.*,u.email FROM payment_transactions t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 100`).all(),
        env.DB.prepare(`SELECT event_id,event_type,error,created_at,processed_at FROM payment_events WHERE status='failed' ORDER BY created_at DESC LIMIT 100`).all(),
        env.DB.prepare(`SELECT id,email,plan,credits,updated_at FROM users ORDER BY updated_at DESC LIMIT 100`).all(),
      ]);
      return successResponse({ transactions: transactions.results || [], failedEvents: failedEvents.results || [], users: users.results || [] }, requestId);
    }
    if (request.method === 'POST') {
      const body = await request.json<{ userId?: string; amount?: number; note?: string }>();
      const userId = String(body.userId || '');
      const amount = Number(body.amount);
      const note = String(body.note || '').trim().slice(0, 200);
      if (!userId || !Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 10_000 || !note) {
        throw new ValidationError('userId, non-zero integer amount, and note are required');
      }
      const reference = `admin-adjustment:${crypto.randomUUID()}`;
      const result = await env.DB.prepare(
        "UPDATE users SET credits=credits+?,updated_at=datetime('now') WHERE id=? AND credits+?>=0"
      ).bind(amount, userId, amount).run();
      if (!result.meta.changes) throw new ValidationError('User not found or adjustment would create a negative balance');
      await env.DB.batch([
        env.DB.prepare("INSERT INTO credit_ledger(id,user_id,amount,reason,reference) VALUES (?,?,?,'admin_adjustment',?)")
          .bind(crypto.randomUUID(), userId, amount, reference),
        env.DB.prepare("INSERT INTO audit_events(id,event_type,actor,action,resource_type,resource_id,details) VALUES (?,'admin',?,'adjust_credits','user',?,?)")
          .bind(crypto.randomUUID(), auth.actor, userId, JSON.stringify({ amount, note, reference })),
      ]);
      return successResponse({ adjusted: true, reference }, requestId);
    }
    throw new ValidationError('Method not allowed');
  } catch (error) {
    return errorResponse(error, requestId);
  }
};

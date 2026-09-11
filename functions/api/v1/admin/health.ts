import { authenticateRequest } from '../auth';
import { UnauthorizedError, errorResponse, successResponse } from '../../../lib/errors';

interface Env {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  WORDMARKS_MCP_TOKEN?: string;
  OPENAI_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
}

type Check = { status: 'up' | 'down' | 'missing'; latencyMs?: number; detail?: string };

async function timed(request: () => Promise<Response>): Promise<Check> {
  const started = Date.now();
  try {
    const response = await request();
    return {
      status: response.ok ? 'up' : 'down',
      latencyMs: Date.now() - started,
      detail: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - started, detail: error instanceof Error ? error.message : 'Request failed' };
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();
  const auth = await authenticateRequest(request, env, true);
  if (!auth.isAdmin) return errorResponse(new UnauthorizedError('Admin authentication required'), requestId);

  const dbStarted = Date.now();
  let database: Check;
  try {
    await env.DB.prepare('SELECT 1 AS ok').first();
    database = { status: 'up', latencyMs: Date.now() - dbStarted };
  } catch (error) {
    database = { status: 'down', latencyMs: Date.now() - dbStarted, detail: error instanceof Error ? error.message : 'Database failed' };
  }

  const ai: Check = env.OPENAI_API_KEY
    ? await timed(() => fetch('https://api.pesatrouter.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'pesat-pro', messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 2 }),
      }))
    : { status: 'missing', detail: 'OPENAI_API_KEY is not configured' };

  const stripe: Check = env.STRIPE_SECRET_KEY
    ? await timed(() => fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }))
    : { status: 'missing', detail: 'STRIPE_SECRET_KEY is not configured' };

  const email: Check = env.RESEND_API_KEY
    ? await timed(() => fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } }))
    : { status: 'missing', detail: 'RESEND_API_KEY is not configured' };

  return successResponse({ checkedAt: new Date().toISOString(), checks: { database, ai, stripe, email } }, requestId);
};

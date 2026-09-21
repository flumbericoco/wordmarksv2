import { authenticateRequest } from '../auth';
import { UnauthorizedError, errorResponse, successResponse } from '../../../lib/errors';
import { getPayPalConfig, getPayPalApiBase } from '../../../lib/paypal';

interface Env {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  WORDMARKS_MCP_TOKEN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  KB_BUCKET?: R2Bucket;
  GENERATED_BUCKET?: R2Bucket;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_MODE?: string;
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

  const openAiKey = env.OPENAI_IMAGE_API_KEY || env.OPENAI_API_KEY;
  const ai: Check = openAiKey
    ? await timed(() => fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${openAiKey}` },
      }))
    : { status: 'missing', detail: 'OPENAI_IMAGE_API_KEY is not configured' };

  const paypalConfig = await getPayPalConfig(env.DB, env);
  let paypal: Check;
  if (paypalConfig.configured) {
    const base = getPayPalApiBase(paypalConfig.mode);
    const credentials = btoa(`${paypalConfig.clientId}:${paypalConfig.clientSecret}`);
    paypal = await timed(() => fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    }));
    if (paypal.status === 'up') {
      paypal.detail = `${paypalConfig.mode.toUpperCase()} connected`;
    }
  } else {
    paypal = { status: 'missing', detail: 'PayPal credentials not configured' };
  }

  const stripe: Check = env.STRIPE_SECRET_KEY
    ? await timed(() => fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }))
    : { status: 'missing', detail: 'STRIPE_SECRET_KEY is not configured' };

  const email: Check = env.RESEND_API_KEY
    ? await timed(() => fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } }))
    : { status: 'missing', detail: 'RESEND_API_KEY is not configured' };

  const knowledgeStorage: Check = env.KB_BUCKET ? { status: 'up' } : { status: 'missing', detail: 'KB_BUCKET is not bound' };
  const generatedStorage: Check = env.GENERATED_BUCKET ? { status: 'up' } : { status: 'missing', detail: 'GENERATED_BUCKET is not bound' };

  return successResponse({
    checkedAt: new Date().toISOString(),
    checks: { database, ai, paypal, knowledgeStorage, generatedStorage, stripe, email }
  }, requestId);
};

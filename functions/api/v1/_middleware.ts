// ─── Cloudflare Pages Functions Middleware ──────────────
// Runs before every /api/v1/* request

import { authenticateRequest, type AuthContext } from './auth';
import { checkRateLimit, rateLimitHeaders } from './rate-limit';
import { ForbiddenError, UnauthorizedError, RateLimitError, errorResponse } from '../../lib/errors';
import { getUserSession } from './user-auth';

interface Env {
  DB: D1Database;
  WORDMARKS_KV: KVNamespace;
  KB_BUCKET?: R2Bucket;
  GENERATED_BUCKET?: R2Bucket;
  WORDMARKS_MCP_TOKEN?: string;
}

interface MiddlewareContext {
  request: Request;
  env: Env;
  functionPath: string;
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
}

export const onRequest = async (context: MiddlewareContext): Promise<Response> => {
  const { request, env, functionPath, next } = context;
  const requestId = crypto.randomUUID();

  // Add request ID to all responses
  const addHeaders = (res: Response): Response => {
    const newHeaders = new Headers(res.headers);
    newHeaders.set('X-Request-ID', requestId);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  };

  // CORS headers (same-origin only)
  const requestOrigin = request.headers.get('Origin');
  const sameOrigin = !requestOrigin || requestOrigin === new URL(request.url).origin;
  const corsHeaders: Record<string, string> = {
    ...(requestOrigin && sameOrigin ? { 'Access-Control-Allow-Origin': requestOrigin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
    'Access-Control-Max-Age': '86400',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    if (!sameOrigin) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Skip auth/rate-limit for health check
  const isHealthCheck = functionPath.endsWith('/health');
  if (isHealthCheck) {
    let response: Response;
    try {
      response = await next();
    } catch (err) {
      response = errorResponse(err, requestId);
    }
    const finalHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => finalHeaders.set(k, v));
    finalHeaders.set('X-Request-ID', requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: finalHeaders,
    });
  }

  // Determine if admin route
  const isAdminRoute = functionPath.includes('/admin/');

  // Authenticate
  let auth: AuthContext = await authenticateRequest(request, env, isAdminRoute);
  if (!auth.authenticated && !isAdminRoute) {
    const user = await getUserSession(request, env.DB).catch(() => null);
    if (user) auth = { authenticated: true, isAdmin: false, actor: `user:${user.id}` };
  }

  const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const isStripeWebhookPath = functionPath.endsWith('/billing/webhook');
  if (unsafeMethod && requestOrigin && !sameOrigin && !isStripeWebhookPath) {
    return addHeaders(errorResponse(new ForbiddenError('Cross-origin request rejected'), requestId));
  }
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 8_000_000) {
    return addHeaders(new Response(JSON.stringify({ ok: false, error: 'Request body too large', requestId }), { status: 413, headers: { 'Content-Type': 'application/json' } }));
  }

  if (isAdminRoute && !auth.isAdmin) {
    return addHeaders(
      errorResponse(new UnauthorizedError('Admin authentication required'), requestId)
    );
  }

  // Rate limiting
  // Account sessions are validated by their route handler, but should receive
  // the authenticated rate-limit tier instead of being throttled as visitors.
  const tier = !auth.authenticated ? 'unauthenticated'
    : isAdminRoute ? 'admin'
    : functionPath.includes('generate') ? 'generation'
    : 'authenticated';

  // Stripe authenticates webhook requests with its signature in the handler;
  // IP-based middleware throttling could drop legitimate event bursts.
  const isStripeWebhook = isStripeWebhookPath;
  const rlResult = isStripeWebhook
    ? { allowed: true, remaining: 1, limit: 1, resetAt: Date.now() + 60_000 }
    : await checkRateLimit(auth.actor, functionPath, env, tier);

  if (!rlResult.allowed) {
    const err = new RateLimitError(rlResult.retryAfter || 60);
    const resp = errorResponse(err, requestId);
    const headers = new Headers(resp.headers);
    Object.entries(rateLimitHeaders(rlResult)).forEach(([k, v]) => headers.set(k, v));
    return addHeaders(new Response(resp.body, { status: resp.status, headers }));
  }

  // Execute handler
  let response: Response;
  try {
    response = await next();
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'unhandled_api_error',
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    response = errorResponse(err, requestId);
  }

  // Add CORS + rate limit + request ID headers
  const finalHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => finalHeaders.set(k, v));
  finalHeaders.set('X-Content-Type-Options', 'nosniff');
  finalHeaders.set('X-Frame-Options', 'DENY');
  finalHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  finalHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  finalHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  finalHeaders.set('X-Request-ID', requestId);
  Object.entries(rateLimitHeaders(rlResult)).forEach(([k, v]) => finalHeaders.set(k, v));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: finalHeaders,
  });
};

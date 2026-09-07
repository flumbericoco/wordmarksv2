// ─── Cloudflare Pages Functions Middleware ──────────────
// Runs before every /api/v1/* request

import { authenticateRequest, type AuthContext } from './auth';
import { checkRateLimit, rateLimitHeaders } from './rate-limit';
import { UnauthorizedError, RateLimitError, errorResponse } from '../../lib/errors';

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
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
    'Access-Control-Max-Age': '86400',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
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
  const auth: AuthContext = authenticateRequest(request, env, isAdminRoute);

  if (isAdminRoute && !auth.isAdmin) {
    return addHeaders(
      errorResponse(new UnauthorizedError('Admin authentication required'), requestId)
    );
  }

  // Rate limiting
  const tier = !auth.authenticated ? 'unauthenticated'
    : isAdminRoute ? 'admin'
    : functionPath.includes('generate') ? 'generation'
    : 'authenticated';

  const rlResult = await checkRateLimit(auth.actor, functionPath, env, tier);

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
  finalHeaders.set('X-Request-ID', requestId);
  Object.entries(rateLimitHeaders(rlResult)).forEach(([k, v]) => finalHeaders.set(k, v));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: finalHeaders,
  });
};

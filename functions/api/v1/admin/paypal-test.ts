import { authenticateRequest } from '../auth';
import { UnauthorizedError, ValidationError, errorResponse, successResponse } from '../../../lib/errors';
import { testPayPalCredentials, getPayPalConfig } from '../../../lib/paypal';

interface Env {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  WORDMARKS_MCP_TOKEN?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_MODE?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();
  const auth = await authenticateRequest(request, env, true);
  if (!auth.isAdmin) {
    return errorResponse(new UnauthorizedError('Admin authentication required'), requestId);
  }

  try {
    const rawBody = await request.json().catch(() => ({}));
    const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<string, unknown>;
    let clientId = String(body.clientId || '').trim();
    let clientSecret = String(body.clientSecret || '').trim();
    let mode: 'sandbox' | 'live' = body.mode === 'live' ? 'live' : 'sandbox';

    // If credentials are not supplied in request body, fallback to DB settings or env
    if (!clientId || !clientSecret) {
      const storedConfig = await getPayPalConfig(env.DB, env);
      clientId = clientId || storedConfig.clientId;
      clientSecret = clientSecret || storedConfig.clientSecret;
      mode = (body.mode === 'live' || body.mode === 'sandbox') ? body.mode : storedConfig.mode;
    }

    if (!clientId || !clientSecret) {
      throw new ValidationError('PayPal Client ID and Client Secret are required to test connection');
    }

    const testResult = await testPayPalCredentials(clientId, clientSecret, mode);
    if (!testResult.ok) {
      return successResponse({
        connected: false,
        mode: testResult.mode,
        error: testResult.error || 'Connection failed',
      }, requestId);
    }

    return successResponse({
      connected: true,
      mode: testResult.mode,
      appId: testResult.appId,
      message: `Successfully connected to PayPal ${testResult.mode.toUpperCase()} environment!`,
    }, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
};

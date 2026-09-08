// ─── Auth Utilities for Cloudflare Pages Functions ─────

export interface AuthContext {
  authenticated: boolean;
  isAdmin: boolean;
  token?: string;
  actor: string; // IP or token identifier
}

/**
 * Extract Bearer token from Authorization header
 */
export function extractToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Get client IP from Cloudflare headers
 */
export function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
}

/**
 * Validate MCP token against environment secret
 */
function validateMcpToken(token: string, env: { WORDMARKS_MCP_TOKEN?: string }): boolean {
  if (!env.WORDMARKS_MCP_TOKEN) return false;
  // Constant-time comparison to prevent timing attacks
  const expected = env.WORDMARKS_MCP_TOKEN;
  if (token.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < token.length; i++) {
    result |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

function constantTimeEqual(value: string, expected?: string): boolean {
  if (!expected || value.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < value.length; i++) result |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return result === 0;
}

function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Check if request has valid Cloudflare Access JWT
 * NOTE: Full JWT validation requires Cloudflare Access to be configured account-side.
 * For now, we check for the presence of the header as a signal.
 */
function hasCfAccessJwt(request: Request): boolean {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  return !!jwt && jwt.length > 10;
}

/**
 * Authenticate request and determine authorization level
 */
export function authenticateRequest(
  request: Request,
  env: { WORDMARKS_MCP_TOKEN?: string; ADMIN_PASSWORD?: string },
  requireAdmin = false,
): AuthContext {
  const ip = getClientIp(request);
  const token = extractToken(request);

  // Admin Studio uses an HttpOnly cookie, so secrets are never stored in JS/localStorage.
  const adminCookie = getCookie(request, 'wm_admin');
  if (adminCookie && (
    constantTimeEqual(adminCookie, env.ADMIN_PASSWORD) ||
    (!env.ADMIN_PASSWORD && constantTimeEqual(adminCookie, env.WORDMARKS_MCP_TOKEN))
  )) {
    return { authenticated: true, isAdmin: true, actor: `admin-cookie:${ip}` };
  }

  // Check MCP token
  if (token && validateMcpToken(token, env)) {
    return {
      authenticated: true,
      isAdmin: true,
      token,
      actor: `token:${token.slice(0, 8)}...`,
    };
  }

  // Check Cloudflare Access JWT
  if (hasCfAccessJwt(request)) {
    return {
      authenticated: true,
      isAdmin: true, // CF Access is admin-level
      actor: `cf-access:${ip}`,
    };
  }

  // If admin is required and no auth matched, deny
  if (requireAdmin) {
    return {
      authenticated: false,
      isAdmin: false,
      actor: ip,
    };
  }

  // For non-admin endpoints, allow unauthenticated with rate limits
  return {
    authenticated: false,
    isAdmin: false,
    actor: ip,
  };
}

/**
 * Require admin authentication or throw
 */
export function requireAdmin(auth: AuthContext): void {
  if (!auth.isAdmin) {
    throw new AdminAuthRequiredError();
  }
}

export class AdminAuthRequiredError extends Error {
  constructor() {
    super('Admin authentication required');
    this.name = 'AdminAuthRequiredError';
  }
}

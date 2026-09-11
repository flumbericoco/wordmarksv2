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

export function getCookie(request: Request, name: string): string | null {
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
const encoder = new TextEncoder();

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function adminSessionKey(value: string, secret: string): Promise<string> {
  return `admin-session:${await hmac(value, secret)}`;
}

export async function createAdminSession(secret: string, lifetimeSeconds = 60 * 60): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  const nonce = crypto.randomUUID();
  const payload = `${expires}.${nonce}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

async function validateAdminSession(value: string, secret?: string): Promise<boolean> {
  if (!secret) return false;
  const [expiresText, nonce, signature, ...extra] = value.split('.');
  if (extra.length || !expiresText || !nonce || !signature) return false;
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) return false;
  return constantTimeEqual(signature, await hmac(`${expiresText}.${nonce}`, secret));
}

/**
 * Authenticate request and determine authorization level
 */
export async function authenticateRequest(
  request: Request,
  env: { WORDMARKS_MCP_TOKEN?: string; ADMIN_PASSWORD?: string; DB?: D1Database },
  requireAdmin = false,
): Promise<AuthContext> {
  const ip = getClientIp(request);
  const token = extractToken(request);

  // Admin Studio uses an HttpOnly cookie, so secrets are never stored in JS/localStorage.
  const adminCookie = getCookie(request, 'wm_admin');
  if (adminCookie && await validateAdminSession(adminCookie, env.ADMIN_PASSWORD)) {
    if (env.DB && env.ADMIN_PASSWORD) {
      const key = await adminSessionKey(adminCookie, env.ADMIN_PASSWORD);
      const row = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{ value: string }>();
      const expires = Number(row?.value || 0);
      if (expires > Math.floor(Date.now() / 1000)) {
        return { authenticated: true, isAdmin: true, actor: `admin-cookie:${ip}` };
      }
      if (row) await env.DB.prepare('DELETE FROM settings WHERE key=?').bind(key).run().catch(() => undefined);
    } else if (!env.DB) {
      return { authenticated: true, isAdmin: true, actor: `admin-cookie:${ip}` };
    }
  }

  // The legacy MCP token authenticates integrations only. It never grants admin access.
  if (token && validateMcpToken(token, env)) {
    return {
      authenticated: true,
      isAdmin: false,
      token,
      actor: `token:${token.slice(0, 8)}...`,
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

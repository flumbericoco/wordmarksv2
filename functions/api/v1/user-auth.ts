export interface UserSession {
  id: string;
  email: string;
  plan: string;
  credits: number;
  stripeCustomerId: string | null;
}

const encoder = new TextEncoder();

export function randomToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    // Cloudflare Workers currently caps PBKDF2 at 100,000 iterations.
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100_000 },
    material,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export function sessionCookie(token: string, maxAge = 60 * 60 * 24 * 30): string {
  return `wm_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function getUserSession(request: Request, db: D1Database): Promise<UserSession | null> {
  const token = readCookie(request, 'wm_session');
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await db.prepare(
    `SELECT u.id, u.email, u.plan, u.credits, u.stripe_customer_id
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now') LIMIT 1`
  ).bind(tokenHash).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id), email: String(row.email), plan: String(row.plan),
    credits: Number(row.credits), stripeCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
  };
}

export async function getApiKeyUser(request: Request, db: D1Database): Promise<(UserSession & { keyId: string }) | null> {
  const match = request.headers.get('Authorization')?.match(/^Bearer\s+(wm_(?:live|test)_[a-f0-9]+)$/i);
  if (!match) return null;
  const keyHash = await sha256(match[1]);
  const row = await db.prepare(
    `SELECT k.id AS key_id, u.id, u.email, u.plan, u.credits, u.stripe_customer_id
     FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = ? AND k.revoked_at IS NULL LIMIT 1`
  ).bind(keyHash).first<Record<string, unknown>>();
  if (!row) return null;
  await db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).bind(row.key_id).run();
  return {
    keyId: String(row.key_id), id: String(row.id), email: String(row.email), plan: String(row.plan),
    credits: Number(row.credits), stripeCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
  };
}

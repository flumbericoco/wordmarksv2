import { getUserSession, hashPassword, randomToken, sessionCookie, sha256 } from '../user-auth';

interface Env { DB: D1Database }

const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers });

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try { return await request.json<Record<string, unknown>>(); }
  catch { return {}; }
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  const action = String((params as { action?: string }).action || '');

  if (action === 'register' && request.method === 'POST') {
    const body = await bodyOf(request);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Valid email is required' }, 400);
    if (password.length < 10) return json({ error: 'Password must be at least 10 characters' }, 400);
    const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (exists) return json({ error: 'Email is already registered' }, 409);

    const id = crypto.randomUUID();
    const salt = randomToken(16);
    const passwordHash = await hashPassword(password, salt);
    const token = randomToken();
    const tokenHash = await sha256(token);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)').bind(id, email, passwordHash, salt),
      env.DB.prepare("INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))").bind(crypto.randomUUID(), id, tokenHash),
    ]);
    return json({ ok: true, user: { id, email, plan: 'none', credits: 0 } }, 201, { 'Set-Cookie': sessionCookie(token) });
  }

  if (action === 'login' && request.method === 'POST') {
    const body = await bodyOf(request);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<Record<string, unknown>>();
    if (!user || await hashPassword(password, String(user.password_salt)) !== String(user.password_hash)) {
      return json({ error: 'Invalid email or password' }, 401);
    }
    const token = randomToken();
    await env.DB.prepare("INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))")
      .bind(crypto.randomUUID(), user.id, await sha256(token)).run();
    return json({ ok: true, user: { id: user.id, email, plan: user.plan, credits: user.credits } }, 200, { 'Set-Cookie': sessionCookie(token) });
  }

  if (action === 'logout' && request.method === 'POST') {
    const session = await getUserSession(request, env.DB);
    const cookie = request.headers.get('Cookie')?.match(/wm_session=([^;]+)/)?.[1];
    if (session && cookie) await env.DB.prepare('DELETE FROM user_sessions WHERE token_hash = ?').bind(await sha256(decodeURIComponent(cookie))).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  const user = await getUserSession(request, env.DB);
  if (!user) return json({ error: 'Authentication required' }, 401);

  if (action === 'me' && request.method === 'GET') return json({ ok: true, user });

  if (action === 'keys' && request.method === 'GET') {
    const keys = await env.DB.prepare(
      'SELECT id, name, key_prefix, last_used_at, revoked_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user.id).all();
    return json({ ok: true, keys: keys.results || [] });
  }

  if (action === 'create-key' && request.method === 'POST') {
    const body = await bodyOf(request);
    const name = String(body.name || 'My AI agent').trim().slice(0, 60);
    const rawKey = `wm_live_${randomToken(24)}`;
    const prefix = `${rawKey.slice(0, 15)}...`;
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES (?, ?, ?, ?, ?)')
      .bind(id, user.id, name, prefix, await sha256(rawKey)).run();
    return json({ ok: true, key: { id, name, prefix, token: rawKey } }, 201);
  }

  if (action === 'revoke-key' && request.method === 'POST') {
    const body = await bodyOf(request);
    await env.DB.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .bind(String(body.id || ''), user.id).run();
    return json({ ok: true });
  }

  if (action === 'usage' && request.method === 'GET') {
    const ledger = await env.DB.prepare('SELECT amount, reason, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(user.id).all();
    return json({ ok: true, credits: user.credits, ledger: ledger.results || [] });
  }

  return json({ error: 'Not found' }, 404);
};

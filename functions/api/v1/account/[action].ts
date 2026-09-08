import { getUserSession, hashPassword, randomToken, sessionCookie, sha256 } from '../user-auth';

interface Env { DB: D1Database; RESEND_API_KEY?: string; EMAIL_FROM?: string }

const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers });

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try { return await request.json<Record<string, unknown>>(); }
  catch { return {}; }
}

async function sendEmail(env: Env, to: string, subject: string, html: string, idempotencyKey: string) {
  if (!env.RESEND_API_KEY) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'Wordmarks <onboarding@resend.dev>', to: [to], subject, html }),
  });
  if (!response.ok) throw new Error('Unable to send account email');
  return true;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  const action = String((params as { action?: string }).action || '');

  if (action === 'request-reset' && request.method === 'POST') {
    const body = await bodyOf(request);
    const email = String(body.email || '').trim().toLowerCase();
    const found = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first<{ id: string }>();
    if (found && env.RESEND_API_KEY) {
      const token = randomToken();
      await env.DB.prepare("INSERT INTO auth_tokens(id,user_id,token_hash,purpose,expires_at) VALUES (?,?,?,'password_reset',datetime('now','+1 hour'))")
        .bind(crypto.randomUUID(), found.id, await sha256(token)).run();
      const url = `${new URL(request.url).origin}/account/reset?token=${encodeURIComponent(token)}`;
      await sendEmail(env, email, 'Reset your Wordmarks password', `<p>Use this secure link within one hour:</p><p><a href="${url}">Reset password</a></p>`, `reset-${await sha256(token)}`);
    }
    return json({ ok: true, message: 'If the account exists, a reset link has been sent.' });
  }

  if (action === 'reset-password' && request.method === 'POST') {
    const body = await bodyOf(request);
    const token = String(body.token || '');
    const password = String(body.password || '');
    if (password.length < 10) return json({ error: 'Password must be at least 10 characters' }, 400);
    const found = await env.DB.prepare("SELECT id,user_id FROM auth_tokens WHERE token_hash=? AND purpose='password_reset' AND used_at IS NULL AND expires_at>datetime('now')")
      .bind(await sha256(token)).first<{ id: string; user_id: string }>();
    if (!found) return json({ error: 'Reset link is invalid or expired' }, 400);
    const salt = randomToken(16);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash=?,password_salt=?,updated_at=datetime('now') WHERE id=?").bind(await hashPassword(password, salt), salt, found.user_id),
      env.DB.prepare("UPDATE auth_tokens SET used_at=datetime('now') WHERE id=?").bind(found.id),
      env.DB.prepare('DELETE FROM user_sessions WHERE user_id=?').bind(found.user_id),
    ]);
    return json({ ok: true });
  }

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
      env.DB.prepare('INSERT INTO users (id, email, password_hash, password_salt, credits) VALUES (?, ?, ?, ?, 10)').bind(id, email, passwordHash, salt),
      env.DB.prepare("INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))").bind(crypto.randomUUID(), id, tokenHash),
      env.DB.prepare("INSERT INTO credit_ledger (id,user_id,amount,reason,reference) VALUES (?,?,10,'signup_bonus',?)")
        .bind(crypto.randomUUID(), id, `signup:${id}`),
    ]);
    return json({ ok: true, user: { id, email, plan: 'none', credits: 10 } }, 201, { 'Set-Cookie': sessionCookie(token) });
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

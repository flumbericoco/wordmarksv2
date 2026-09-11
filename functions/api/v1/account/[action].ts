import { getUserSession, hashPassword, randomToken, sessionCookie, sha256 } from '../user-auth';
import { recordAudit } from '../audit';

interface Env { DB: D1Database; RESEND_API_KEY?: string; EMAIL_FROM?: string; STRIPE_SECRET_KEY?: string }

const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers });
const MAX_PASSWORD_LENGTH = 128;
const blockedEmailDomains = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'yopmail.com']);

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

const pendingVerificationKey = (userId: string) => `email-pending:${userId}`;

async function issueVerificationEmail(env: Env, origin: string, userId: string, email: string): Promise<boolean> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  await env.DB.batch([
    env.DB.prepare("UPDATE auth_tokens SET used_at=datetime('now') WHERE user_id=? AND purpose='email_verification' AND used_at IS NULL").bind(userId),
    env.DB.prepare("INSERT INTO auth_tokens(id,user_id,token_hash,purpose,expires_at) VALUES(?,?,?,'email_verification',datetime('now','+24 hours'))")
      .bind(crypto.randomUUID(), userId, tokenHash),
  ]);
  const url = `${origin}/api/v1/account/verify-email?token=${encodeURIComponent(token)}`;
  return sendEmail(
    env,
    email,
    'Verify your Wordmarks account',
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px"><h1 style="font-size:26px">Verify your email</h1><p>Confirm this email address to activate your Wordmarks account and start using the logo generator.</p><p style="margin:28px 0"><a href="${url}" style="background:#171714;color:#fff;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:700">Verify email</a></p><p style="color:#777;font-size:13px">This secure link expires in 24 hours and can only be used once.</p></div>`,
    `verify-${tokenHash}`,
  );
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  const action = String((params as { action?: string }).action || '');

  if (action === 'request-reset' && request.method === 'POST') {
    const body = await bodyOf(request);
    const email = String(body.email || '').trim().toLowerCase();
    if (email.length > 254) return json({ ok: true, message: 'If the account exists, a reset link has been sent.' });
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
    if (token.length < 32 || token.length > 512) return json({ error: 'Reset link is invalid or expired' }, 400);
    if (password.length < 10 || password.length > MAX_PASSWORD_LENGTH) return json({ error: 'Password must be 10 to 128 characters' }, 400);
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

  if (action === 'verify-email' && request.method === 'GET') {
    const token = new URL(request.url).searchParams.get('token') || '';
    if (token.length < 32 || token.length > 512) return Response.redirect(`${new URL(request.url).origin}/account?verification=invalid`, 302);
    const found = await env.DB.prepare("SELECT id,user_id FROM auth_tokens WHERE token_hash=? AND purpose='email_verification' AND used_at IS NULL AND expires_at>datetime('now')")
      .bind(await sha256(token)).first<{ id: string; user_id: string }>();
    if (!found) return Response.redirect(`${new URL(request.url).origin}/account?verification=invalid`, 302);
    const sessionToken = randomToken();
    await env.DB.batch([
      env.DB.prepare("UPDATE auth_tokens SET used_at=datetime('now') WHERE id=?").bind(found.id),
      env.DB.prepare('DELETE FROM settings WHERE key=?').bind(pendingVerificationKey(found.user_id)),
      env.DB.prepare("INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,datetime('now','+30 days'))")
        .bind(crypto.randomUUID(), found.user_id, await sha256(sessionToken)),
    ]);
    await recordAudit(env.DB, `user:${found.user_id}`, 'verify_email', 'user', found.user_id);
    return new Response(null, { status: 302, headers: { Location: `${new URL(request.url).origin}/account?verified=1`, 'Set-Cookie': sessionCookie(sessionToken) } });
  }

  if (action === 'resend-verification' && request.method === 'POST') {
    const body = await bodyOf(request);
    const email = String(body.email || '').trim().toLowerCase();
    if (email.length <= 254) {
      const found = await env.DB.prepare("SELECT u.id,u.email FROM users u JOIN settings s ON s.key=('email-pending:' || u.id) WHERE u.email=? LIMIT 1")
        .bind(email).first<{ id: string; email: string }>();
      if (found) await issueVerificationEmail(env, new URL(request.url).origin, found.id, found.email).catch(() => false);
    }
    return json({ ok: true, message: 'If verification is pending, a new email has been sent.' });
  }

  if (action === 'register' && request.method === 'POST') {
    const body = await bodyOf(request);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (email.length > 254) return json({ error: 'Valid email is required' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Valid email is required' }, 400);
    if (password.length < 10 || password.length > MAX_PASSWORD_LENGTH) return json({ error: 'Password must be 10 to 128 characters' }, 400);
    if (blockedEmailDomains.has(email.split('@')[1] || '')) return json({ error: 'Disposable email addresses are not allowed' }, 400);
    const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (exists) return json({ error: 'Email is already registered' }, 409);

    const id = crypto.randomUUID();
    const salt = randomToken(16);
    const passwordHash = await hashPassword(password, salt);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, email, password_hash, password_salt, credits) VALUES (?, ?, ?, ?, 0)').bind(id, email, passwordHash, salt),
      env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,datetime('now'))").bind(pendingVerificationKey(id), email),
    ]);
    const emailSent = await issueVerificationEmail(env, new URL(request.url).origin, id, email).catch(() => false);
    await recordAudit(env.DB, `user:${id}`, 'registration_pending_verification', 'user', id, { emailSent });
    return json({ ok: true, verificationRequired: true, emailSent, email, message: emailSent ? 'Check your email to activate your account.' : 'Account created, but verification email could not be sent. Use resend verification.' }, 201);
  }

  if (action === 'login' && request.method === 'POST') {
    const body = await bodyOf(request);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (password.length > MAX_PASSWORD_LENGTH || email.length > 254) return json({ error: 'Invalid email or password' }, 401);
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<Record<string, unknown>>();
    if (!user || await hashPassword(password, String(user.password_salt)) !== String(user.password_hash)) {
      return json({ error: 'Invalid email or password' }, 401);
    }
    const pending = await env.DB.prepare('SELECT key FROM settings WHERE key=?').bind(pendingVerificationKey(String(user.id))).first();
    if (pending) return json({ error: 'Verify your email before signing in.', code: 'EMAIL_NOT_VERIFIED', verificationRequired: true, email }, 403);
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
    const activeKeys = await env.DB.prepare('SELECT COUNT(*) AS count FROM api_keys WHERE user_id=? AND revoked_at IS NULL').bind(user.id).first<{ count: number }>();
    if (Number(activeKeys?.count || 0) >= 10) return json({ error: 'Maximum of 10 active API keys reached' }, 409);
    const rawKey = `wm_live_${randomToken(24)}`;
    const prefix = `${rawKey.slice(0, 15)}...`;
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES (?, ?, ?, ?, ?)')
      .bind(id, user.id, name, prefix, await sha256(rawKey)).run();
    await recordAudit(env.DB, `user:${user.id}`, 'create_api_key', 'api_key', id, { name, prefix });
    return json({ ok: true, key: { id, name, prefix, token: rawKey } }, 201);
  }

  if (action === 'revoke-key' && request.method === 'POST') {
    const body = await bodyOf(request);
    const keyId = String(body.id || '');
    await env.DB.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .bind(keyId, user.id).run();
    await recordAudit(env.DB, `user:${user.id}`, 'revoke_api_key', 'api_key', keyId);
    return json({ ok: true });
  }

  if (action === 'usage' && request.method === 'GET') {
    const ledger = await env.DB.prepare('SELECT amount, reason, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(user.id).all();
    return json({ ok: true, credits: user.credits, ledger: ledger.results || [] });
  }

  if (action === 'generations' && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT id,brand_name,status,model,result_url,error,duration_ms,created_at,completed_at
       FROM generation_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 50`
    ).bind(user.id).all();
    return json({ ok: true, generations: rows.results || [] });
  }

  if (action === 'delete-account' && request.method === 'POST') {
    const body = await bodyOf(request);
    const password = String(body.password || '');
    const stored = await env.DB.prepare('SELECT password_hash,password_salt FROM users WHERE id=?')
      .bind(user.id).first<{ password_hash: string; password_salt: string }>();
    if (!stored || await hashPassword(password, stored.password_salt) !== stored.password_hash) {
      return json({ error: 'Password is incorrect' }, 403);
    }
    const active = await env.DB.prepare("SELECT stripe_subscription_id FROM subscriptions WHERE user_id=? AND status IN ('active','trialing','past_due') LIMIT 1")
      .bind(user.id).first();
    if (active) return json({ error: 'Cancel the active subscription in Billing before deleting your account.' }, 409);
    if (user.stripeCustomerId) {
      if (!env.STRIPE_SECRET_KEY) return json({ error: 'Unable to verify billing status. Try again later.' }, 503);
      const stripe = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(user.stripeCustomerId)}&status=all&limit=20`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      });
      if (!stripe.ok) return json({ error: 'Unable to verify billing status. Try again later.' }, 503);
      const payload = await stripe.json<{ data?: Array<{ status?: string }> }>();
      if (payload.data?.some((subscription) => ['active', 'trialing', 'past_due', 'unpaid'].includes(String(subscription.status)))) {
        return json({ error: 'Cancel the active Stripe subscription before deleting your account.' }, 409);
      }
    }
    await env.DB.prepare("INSERT INTO audit_events(id,event_type,actor,action,resource_type,resource_id,details) VALUES(?,'account',?,'delete_account','user',?,?)")
      .bind(crypto.randomUUID(), `user:${user.id}`, user.id, JSON.stringify({ email: user.email })).run();
    await env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.id).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (action === 'generation-feedback' && request.method === 'POST') {
    const body = await bodyOf(request);
    const generationId = String(body.generationId || '');
    const rating = Number(body.rating);
    if (!generationId || ![1, 2, 3, 4, 5].includes(rating)) return json({ error: 'A rating from 1 to 5 is required' }, 400);
    const owned = await env.DB.prepare('SELECT id FROM generation_jobs WHERE id=? AND user_id=?').bind(generationId, user.id).first();
    if (!owned) return json({ error: 'Logo not found' }, 404);
    await env.DB.prepare("INSERT INTO audit_events(id,event_type,actor,action,resource_type,resource_id,details) VALUES (?,'feedback',?,'rate_generation','generation',?,?)")
      .bind(crypto.randomUUID(), `user:${user.id}`, generationId, JSON.stringify({ rating })).run();
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
};

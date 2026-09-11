import { adminSessionKey, authenticateRequest, createAdminSession, getCookie } from '../auth';

interface Env {
  DB?: D1Database;
  ADMIN_PASSWORD?: string;
  WORDMARKS_MCP_TOKEN?: string;
}

function adminCookie(value: string, maxAge = 60 * 60): string {
  return `wm_admin=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function equal(value: string, expected?: string): boolean {
  if (!expected || value.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < value.length; i++) mismatch |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  const action = String((params as { action?: string }).action || '');

  if (action === 'login' && request.method === 'POST') {
    const body: { password?: string } = await request.json<{ password?: string }>().catch(() => ({}));
    const password = String(body.password || '');
    const expected = env.ADMIN_PASSWORD;
    if (!expected) {
      return Response.json({ ok: false, error: 'Admin login is not configured' }, { status: 503 });
    }
    if (!equal(password, expected)) {
      if (env.DB) await env.DB.prepare("INSERT INTO audit_events(id,event_type,actor,action,resource_type,details) VALUES(?,'admin_auth','anonymous','login_failed','admin',?)")
        .bind(crypto.randomUUID(), JSON.stringify({ at: new Date().toISOString() })).run().catch(() => undefined);
      return Response.json({ ok: false, error: 'Invalid admin password' }, { status: 401 });
    }
    const session = await createAdminSession(expected);
    if (env.DB) {
      const expires = Number(session.split('.')[0]);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO audit_events(id,event_type,actor,action,resource_type,details) VALUES(?,'admin_auth','admin','login_success','admin',?)")
          .bind(crypto.randomUUID(), JSON.stringify({ at: new Date().toISOString() })),
        env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')")
          .bind(await adminSessionKey(session, expected), String(expires)),
      ]);
    }
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': adminCookie(session) } });
  }

  if (action === 'logout' && request.method === 'POST') {
    const session = getCookie(request, 'wm_admin');
    if (session && env.DB && env.ADMIN_PASSWORD) {
      await env.DB.prepare('DELETE FROM settings WHERE key=?')
        .bind(await adminSessionKey(session, env.ADMIN_PASSWORD)).run().catch(() => undefined);
    }
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': adminCookie('', 0) } });
  }

  if (action === 'session' && request.method === 'GET') {
    const auth = await authenticateRequest(request, env, true);
    return Response.json({ ok: auth.isAdmin }, { status: auth.isAdmin ? 200 : 401 });
  }

  return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
};

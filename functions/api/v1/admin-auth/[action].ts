import { authenticateRequest } from '../auth';

interface Env {
  ADMIN_PASSWORD?: string;
  WORDMARKS_MCP_TOKEN?: string;
}

function adminCookie(value: string, maxAge = 60 * 60 * 8): string {
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
    const expected = env.ADMIN_PASSWORD || env.WORDMARKS_MCP_TOKEN;
    if (!equal(password, expected)) {
      return Response.json({ ok: false, error: 'Invalid admin password' }, { status: 401 });
    }
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': adminCookie(password) } });
  }

  if (action === 'logout' && request.method === 'POST') {
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': adminCookie('', 0) } });
  }

  if (action === 'session' && request.method === 'GET') {
    const auth = authenticateRequest(request, env, true);
    return Response.json({ ok: auth.isAdmin }, { status: auth.isAdmin ? 200 : 401 });
  }

  return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
};

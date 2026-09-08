import { authenticateRequest } from '../api/v1/auth';

interface Env {
  ADMIN_PASSWORD?: string;
  WORDMARKS_MCP_TOKEN?: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);
  if (url.pathname === '/admin/login' || url.pathname.startsWith('/admin/login/')) return next();

  const auth = authenticateRequest(request, env, true);
  if (auth.isAdmin) return next();

  const login = new URL('/admin/login', url.origin);
  login.searchParams.set('next', `${url.pathname}${url.search}`);
  return Response.redirect(login, 302);
};

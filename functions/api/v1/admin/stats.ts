// ─── Admin: Dashboard Stats ─────────────────────────────

import { successResponse, errorResponse, UnauthorizedError } from '../../../lib/errors';
import { authenticateRequest } from '../auth';

interface Env {
  DB: D1Database;
  WORDMARKS_KV: KVNamespace;
  WORDMARKS_MCP_TOKEN?: string;
}

interface FunctionContext {
  request: Request;
  env: Env;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();

  // Explicit auth check (defense-in-depth)
  const auth = await authenticateRequest(request, env, true);
  if (!auth.isAdmin) {
    return errorResponse(new UnauthorizedError('Admin authentication required'), requestId);
  }

  try {
    if (request.method !== 'GET') {
      return errorResponse(new Error('Method not allowed'), requestId);
    }

    // Parallel queries for dashboard stats
    const [providerCount, jobStats, kbCount, recentJobs] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as count FROM providers').first<{ count: number }>(),
      env.DB.prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          AVG(duration_ms) as avg_duration_ms
         FROM generation_jobs`
      ).first<{ total: number; completed: number; failed: number; avg_duration_ms: number }>(),
      env.DB.prepare('SELECT COUNT(*) as count FROM knowledge_items').first<{ count: number }>(),
      env.DB.prepare(
        `SELECT id, brand_name, status, model, duration_ms, quality_score, created_at, completed_at
         FROM generation_jobs ORDER BY created_at DESC LIMIT 10`
      ).all(),
    ]);

    const activeProvider = await env.DB.prepare(
      'SELECT name, text_model, image_model FROM providers WHERE is_active = 1 LIMIT 1'
    ).first<{ name: string; text_model: string; image_model: string }>();

    return successResponse({
      providers: {
        total: providerCount?.count || 0,
        active: activeProvider || null,
      },
      generation: {
        total: jobStats?.total || 0,
        completed: jobStats?.completed || 0,
        failed: jobStats?.failed || 0,
        avgDurationMs: Math.round(jobStats?.avg_duration_ms || 0),
      },
      knowledgeBase: {
        total: kbCount?.count || 0,
      },
      recentJobs: recentJobs.results || [],
    }, requestId);
  } catch (err) {
    return errorResponse(err, requestId);
  }
};

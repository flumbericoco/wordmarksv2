// ─── Admin: Redacted Data Export ────────────────────────
// NEVER includes API keys in export

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

  const auth = await authenticateRequest(request, env, true);
  if (!auth.isAdmin) {
    return errorResponse(new UnauthorizedError('Admin authentication required'), requestId);
  }

  try {
    if (request.method !== 'GET') {
      return errorResponse(new Error('Method not allowed'), requestId);
    }

    const [providers, settings, kbItems, jobStats] = await Promise.all([
      env.DB.prepare('SELECT id, name, base_url, text_model, image_model, is_active, created_at FROM providers').all(),
      env.DB.prepare('SELECT * FROM settings').all(),
      env.DB.prepare('SELECT id, filename, category, tags, description, created_at FROM knowledge_items').all(),
      env.DB.prepare(
        `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
         FROM generation_jobs`
      ).first(),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
      // API KEYS ARE NEVER INCLUDED
      providers: providers.results?.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.base_url,
        textModel: p.text_model,
        imageModel: p.image_model,
        isActive: Boolean(p.is_active),
        createdAt: p.created_at,
        // Note: apiKey is redacted
      })) || [],
      settings: settings.results?.reduce((acc, row) => {
        acc[row.key as string] = row.value;
        return acc;
      }, {} as Record<string, string>) || {},
      knowledgeBase: kbItems.results?.map((item) => ({
        id: item.id,
        filename: item.filename,
        category: item.category,
        tags: typeof item.tags === 'string' ? JSON.parse(item.tags || '[]') : item.tags,
        description: item.description,
        createdAt: item.created_at,
        // Note: imageData is redacted
      })) || [],
      stats: {
        totalJobs: jobStats?.total || 0,
        completedJobs: jobStats?.completed || 0,
      },
    };

    return new Response(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="wordmarks-export-${new Date().toISOString().split('T')[0]}.json"`,
        'X-Request-ID': requestId,
      },
    });
  } catch (err) {
    return errorResponse(err, requestId);
  }
};

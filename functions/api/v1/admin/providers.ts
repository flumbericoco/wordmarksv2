// ─── Admin: Provider CRUD ───────────────────────────────

import { successResponse, errorResponse, ValidationError, NotFoundError, UnauthorizedError } from '../../../lib/errors';
import { validateProviderRequest, type ProviderRequest } from '../../../lib/validation';
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

// Redact API keys in responses
function redactProvider(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    textModel: row.text_model,
    imageModel: row.image_model,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // apiKey is NEVER returned
  };
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();

  const auth = await authenticateRequest(request, env, true);
  if (!auth.isAdmin) {
    return errorResponse(new UnauthorizedError('Admin authentication required'), requestId);
  }

  try {
    const method = request.method;

    if (method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM providers ORDER BY is_active DESC, created_at DESC'
      ).all();
      return successResponse(results.map(redactProvider), requestId);
    }

    if (method === 'POST') {
      const body = await request.json();
      const validated = validateProviderRequest(body);
      if (!validated.valid) throw new ValidationError(validated.error);

      const id = crypto.randomUUID();
      const { name, baseUrl, textModel, imageModel, isActive } = validated.data;

      // If setting active, deactivate others first
      if (isActive) {
        await env.DB.prepare('UPDATE providers SET is_active = 0').run();
      }

      await env.DB.prepare(
        `INSERT INTO providers (id, name, base_url, text_model, image_model, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(id, name, baseUrl, textModel, imageModel || '', isActive ? 1 : 0).run();

      return successResponse({ id, name, baseUrl, textModel, imageModel, isActive }, requestId, 201);
    }

    if (method === 'PUT') {
      const body = await request.json();
      const { id, ...updates } = body as { id: string } & Partial<ProviderRequest>;
      if (!id) throw new ValidationError('id is required');

      const existing = await env.DB.prepare('SELECT * FROM providers WHERE id = ?').bind(id).first();
      if (!existing) throw new NotFoundError('Provider not found');

      const fields: string[] = [];
      const values: unknown[] = [];

      if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
      if (updates.baseUrl !== undefined) { fields.push('base_url = ?'); values.push(updates.baseUrl); }
      if (updates.textModel !== undefined) { fields.push('text_model = ?'); values.push(updates.textModel); }
      if (updates.imageModel !== undefined) { fields.push('image_model = ?'); values.push(updates.imageModel); }
      if (updates.isActive !== undefined) {
        if (updates.isActive) {
          await env.DB.prepare('UPDATE providers SET is_active = 0').run();
        }
        fields.push('is_active = ?');
        values.push(updates.isActive ? 1 : 0);
      }

      if (fields.length > 0) {
        fields.push("updated_at = datetime('now')");
        values.push(id);
        await env.DB.prepare(
          `UPDATE providers SET ${fields.join(', ')} WHERE id = ?`
        ).bind(...values).run();
      }

      const updated = await env.DB.prepare('SELECT * FROM providers WHERE id = ?').bind(id).first();
      return successResponse(updated ? redactProvider(updated) : null, requestId);
    }

    if (method === 'DELETE') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (!id) throw new ValidationError('id query parameter is required');

      const existing = await env.DB.prepare('SELECT * FROM providers WHERE id = ?').bind(id).first();
      if (!existing) throw new NotFoundError('Provider not found');

      await env.DB.prepare('DELETE FROM providers WHERE id = ?').bind(id).run();
      return successResponse({ deleted: true }, requestId);
    }

    throw new ValidationError(`Method ${method} not allowed`);
  } catch (err) {
    return errorResponse(err, requestId);
  }
};

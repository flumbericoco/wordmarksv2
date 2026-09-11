// ─── Admin: Settings CRUD ───────────────────────────────

import { successResponse, errorResponse, ValidationError, UnauthorizedError } from '../../../lib/errors';
import { validateSettingsRequest, type SettingsRequest } from '../../../lib/validation';
import { authenticateRequest } from '../auth';
import { recordAudit } from '../audit';

interface Env {
  DB: D1Database;
  WORDMARKS_KV: KVNamespace;
  WORDMARKS_MCP_TOKEN?: string;
}

interface FunctionContext {
  request: Request;
  env: Env;
}

const DEFAULT_SETTINGS: Record<string, string> = {
  defaultProviderId: '',
  maxIterations: '3',
  imageQuality: 'hd',
  imageSize: '1024x1024',
  autoApprove: 'false',
  knowledgeBaseEnabled: 'true',
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();

  const auth = await authenticateRequest(request, env, true);
  if (!auth.isAdmin) {
    return errorResponse(new UnauthorizedError('Admin authentication required'), requestId);
  }

  try {
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM settings').all();
      const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
      for (const row of results) {
        settings[row.key as string] = row.value;
      }
      // Parse typed values
      return successResponse({
        defaultProviderId: settings.defaultProviderId || '',
        maxIterations: parseInt(String(settings.maxIterations)) || 3,
        imageQuality: settings.imageQuality || 'hd',
        imageSize: settings.imageSize || '1024x1024',
        autoApprove: settings.autoApprove === 'true',
        knowledgeBaseEnabled: settings.knowledgeBaseEnabled !== 'false',
      }, requestId);
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      const body = await request.json();
      const validated = validateSettingsRequest(body);
      if (!validated.valid) throw new ValidationError(validated.error);

      const updates = validated.data;
      const stmts: D1PreparedStatement[] = [];

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          stmts.push(
            env.DB.prepare(
              `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
            ).bind(key, String(value))
          );
        }
      }

      if (stmts.length > 0) {
        await env.DB.batch(stmts);
        await recordAudit(env.DB, auth.actor, 'update_settings', 'settings', undefined, updates);
      }

      // Return updated settings
      const { results } = await env.DB.prepare('SELECT * FROM settings').all();
      const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
      for (const row of results) {
        settings[row.key as string] = row.value;
      }

      return successResponse({
        defaultProviderId: settings.defaultProviderId || '',
        maxIterations: parseInt(String(settings.maxIterations)) || 3,
        imageQuality: settings.imageQuality || 'hd',
        imageSize: settings.imageSize || '1024x1024',
        autoApprove: settings.autoApprove === 'true',
        knowledgeBaseEnabled: settings.knowledgeBaseEnabled !== 'false',
      }, requestId);
    }

    throw new ValidationError(`Method ${request.method} not allowed`);
  } catch (err) {
    return errorResponse(err, requestId);
  }
};

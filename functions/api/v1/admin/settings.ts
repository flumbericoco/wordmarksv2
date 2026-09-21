// ─── Admin: Settings CRUD ───────────────────────────────

import { successResponse, errorResponse, ValidationError, UnauthorizedError } from '../../../lib/errors';
import { validateSettingsRequest, type SettingsRequest } from '../../../lib/validation';
import { authenticateRequest } from '../auth';
import { recordAudit } from '../audit';
import { ELITE_LOGO_DESIGNER_INSTRUCTIONS } from '../../../lib/elite-logo-instructions';

interface Env {
  DB: D1Database;
  WORDMARKS_KV: KVNamespace;
  WORDMARKS_MCP_TOKEN?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_MODE?: string;
  PAYPAL_WEBHOOK_ID?: string;
}

const DEFAULT_SETTINGS: Record<string, string> = {
  systemPrompt: ELITE_LOGO_DESIGNER_INSTRUCTIONS,
  negativePrompt: 'generic stock icon, clipart, template logo, mockup, poster, grid, watermark, tagline, extra text, misspelling, glow, bevel, 3D, photorealistic scene, busy detail',
  defaultProviderId: '',
  maxIterations: '3',
  imageQuality: 'hd',
  imageSize: '1024x1024',
  autoApprove: 'false',
  knowledgeBaseEnabled: 'true',
  paypalClientId: '',
  paypalClientSecret: '',
  paypalMode: 'sandbox',
  paypalWebhookId: '',
};

function formatSettingsResponse(settings: Record<string, unknown>, env: Env) {
  const paypalClientId = String(settings.paypalClientId || env.PAYPAL_CLIENT_ID || '');
  const paypalClientSecret = String(settings.paypalClientSecret || env.PAYPAL_CLIENT_SECRET || '');
  const rawMode = String(settings.paypalMode || env.PAYPAL_MODE || 'sandbox').toLowerCase();
  const paypalMode = rawMode === 'live' ? 'live' : 'sandbox';
  const paypalWebhookId = String(settings.paypalWebhookId || env.PAYPAL_WEBHOOK_ID || '');

  return {
    systemPrompt: settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt,
    negativePrompt: settings.negativePrompt || DEFAULT_SETTINGS.negativePrompt,
    defaultProviderId: settings.defaultProviderId || '',
    maxIterations: parseInt(String(settings.maxIterations)) || 3,
    imageQuality: settings.imageQuality || 'hd',
    imageSize: settings.imageSize || '1024x1024',
    autoApprove: settings.autoApprove === 'true',
    knowledgeBaseEnabled: settings.knowledgeBaseEnabled !== 'false',
    paypalClientId,
    paypalClientSecretConfigured: Boolean(paypalClientSecret),
    paypalClientSecretMasked: paypalClientSecret ? `••••••••••••${paypalClientSecret.slice(-4)}` : '',
    paypalMode,
    paypalWebhookId,
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
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM settings').all();
      const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
      for (const row of results) {
        settings[row.key as string] = row.value;
      }
      return successResponse(formatSettingsResponse(settings, env), requestId);
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      const body = await request.json();
      const validated = validateSettingsRequest(body);
      if (!validated.valid) throw new ValidationError(validated.error);

      const updates = validated.data;
      const stmts: D1PreparedStatement[] = [];

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          // If updating client secret, don't overwrite with empty string if already set
          if (key === 'paypalClientSecret' && String(value).trim() === '') {
            continue;
          }
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
        const auditUpdates = { ...updates };
        if (auditUpdates.paypalClientSecret) auditUpdates.paypalClientSecret = '[REDACTED]';
        await recordAudit(env.DB, auth.actor, 'update_settings', 'settings', undefined, auditUpdates);
      }

      // Return updated settings
      const { results } = await env.DB.prepare('SELECT * FROM settings').all();
      const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
      for (const row of results) {
        settings[row.key as string] = row.value;
      }

      return successResponse(formatSettingsResponse(settings, env), requestId);
    }

    throw new ValidationError(`Method ${request.method} not allowed`);
  } catch (err) {
    return errorResponse(err, requestId);
  }
};

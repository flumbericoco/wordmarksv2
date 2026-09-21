import { errorResponse, successResponse, UnauthorizedError, ValidationError } from '../../../lib/errors';
import { authenticateRequest } from '../auth';
import { isAllowedProvider } from '../providers';

interface Env {
  DB: D1Database;
  WORDMARKS_KV: KVNamespace;
  WORDMARKS_MCP_TOKEN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_API_KEY?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();
  try {
    const auth = await authenticateRequest(request, env, true);
    if (!auth.isAdmin) throw new UnauthorizedError('Admin authentication required');
    const apiKey = env.OPENAI_IMAGE_API_KEY || env.OPENAI_API_KEY;
    if (!apiKey) throw new ValidationError('No OpenAI API key is configured');

    const body: { baseUrl?: string; textModel?: string } = await request.json<{ baseUrl?: string; textModel?: string }>().catch(() => ({}));
    const baseUrl = String(body.baseUrl || '').replace(/\/$/, '');
    const textModel = String(body.textModel || '').trim();
    if (!baseUrl.startsWith('https://') || !textModel || !isAllowedProvider(baseUrl)) throw new ValidationError('Provider URL is not in the approved provider allowlist');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      const officialOpenAi = new URL(baseUrl).hostname === 'api.openai.com';
      response = await fetch(`${baseUrl}/${officialOpenAi ? 'responses' : 'chat/completions'}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(officialOpenAi
          ? { model: textModel, input: 'Reply with OK.' }
          : { model: textModel, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8 }),
        redirect: 'error',
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new ValidationError(`Provider returned HTTP ${response.status}: ${detail.slice(0, 180)}`);
    }
    return successResponse({ connected: true, status: response.status }, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
};

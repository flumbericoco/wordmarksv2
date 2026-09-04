// ─── Main API Handler: /api/v1/[action] ─────────────────
// Routes: research, generate-logo, review-logo, iterate-logo

import { buildResearchPrompt, buildDallePrompt, getQualityReviewPrompt, getIterationPrompt } from '../../lib/prompts';
import { AppError, ValidationError, ProviderError, successResponse, errorResponse } from '../../lib/errors';
import {
  validateResearchRequest,
  validateGenerateRequest,
  validateReviewRequest,
  validateIterateRequest,
  type ResearchRequest,
  type GenerateRequest,
  type ReviewRequest,
  type IterateRequest,
} from '../../lib/validation';
import {
  isAllowedProvider,
  chatCompletionServer,
  generateImageServer,
  parseJsonResponse,
} from './providers';

interface Env {
  DB: D1Database;
  WORDMARKS_KV: KVNamespace;
  KB_BUCKET?: R2Bucket;
  GENERATED_BUCKET?: R2Bucket;
  OPENAI_API_KEY?: string;
  WORDMARKS_MCP_TOKEN?: string;
}

interface FunctionContext {
  request: Request;
  env: Env;
  params: { action: string };
  waitUntil: (promise: Promise<unknown>) => void;
}

// ─── Provider Config Resolution ─────────────────────────

async function getActiveProvider(db: D1Database, env: Env): Promise<{
  apiKey: string;
  baseUrl: string;
  textModel: string;
  imageModel: string;
} | null> {
  // Try D1 first
  try {
    const row = await db.prepare(
      'SELECT * FROM providers WHERE is_active = 1 LIMIT 1'
    ).first();
    if (row) {
      return {
        apiKey: env.OPENAI_API_KEY || '', // Key comes from secret, not DB
        baseUrl: String(row.base_url),
        textModel: String(row.text_model),
        imageModel: String(row.image_model),
      };
    }
  } catch {
    // D1 unavailable
  }

  // Fallback: use env defaults
  if (env.OPENAI_API_KEY) {
    return {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: 'https://api.pesatrouter.com/v1',
      textModel: 'pesat-flash',
      imageModel: 'dall-e-3',
    };
  }

  return null;
}

// ─── Action Handlers ────────────────────────────────────

async function handleResearch(
  body: ResearchRequest,
  provider: { apiKey: string; baseUrl: string; textModel: string },
): Promise<unknown> {
  const prompt = buildResearchPrompt(body.brandName, body.description || '');
  const useJson = isAllowedProvider(provider.baseUrl);

  const content = await chatCompletionServer(
    useJson
      ? 'You are an elite brand strategist. Output ONLY valid JSON.'
      : 'You are an elite brand strategist. Output ONLY valid JSON — no markdown, no code fences, no commentary. Start with { and end with }.',
    prompt,
    provider.apiKey,
    provider.baseUrl,
    provider.textModel,
    { temperature: 0.7, responseFormat: true },
  );

  return parseJsonResponse(content);
}

function sanitizeGeneratedSvg(raw: string): string {
  const match = raw.match(/<svg[\s\S]*?<\/svg>/i);
  if (!match) {
    throw new Error('PesatRouter did not return a valid SVG wordmark');
  }

  return match[0]
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, '')
    .replace(/\s(?:href|xlink:href)\s*=\s*(["'])(?:https?:|javascript:).*?\1/gi, '');
}

async function generateSvgWordmark(
  prompt: string,
  brandName: string,
  provider: { apiKey: string; baseUrl: string; textModel: string },
): Promise<{ url: string; revisedPrompt: string }> {
  const content = await chatCompletionServer(
    'You are an expert identity designer and SVG artist. Return one complete, valid, self-contained SVG only. Do not use markdown, scripts, external URLs, external fonts, or foreignObject. Use a 1200x1200 viewBox, vector shapes, text, and system font fallbacks.',
    `Create a polished typography-first wordmark logo for "${brandName}". ${prompt}`,
    provider.apiKey,
    provider.baseUrl,
    provider.textModel,
    { temperature: 0.8, responseFormat: false, timeoutMs: 60_000 },
  );
  const svg = sanitizeGeneratedSvg(content);
  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    revisedPrompt: prompt,
  };
}

async function handleGenerate(
  body: GenerateRequest,
  provider: { apiKey: string; baseUrl: string; textModel: string; imageModel: string },
  db: D1Database,
  generatedBucket: R2Bucket | undefined,
  requestId: string,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<unknown> {
  const jobId = crypto.randomUUID();
  const startTime = Date.now();

  // Log job start
  waitUntil(
    db.prepare(
      `INSERT INTO generation_jobs (id, request_id, brand_name, status, model, created_at)
       VALUES (?, ?, ?, 'running', ?, datetime('now'))`
    ).bind(jobId, requestId, body.brandName, provider.imageModel).run().catch(() => {})
  );

  try {
    const prompt = buildDallePrompt({
      brandName: body.brandName,
      description: body.description || '',
      style: body.style,
      colorPreference: body.colorPreference,
      layout: body.layout,
      referenceImages: body.referenceImages || [],
    } as import('../../lib/types').WizardData);

    const providerHost = new URL(provider.baseUrl).hostname;
    const useSvgGeneration = providerHost === 'api.pesatrouter.com' || !provider.imageModel;
    const result = useSvgGeneration
      ? await generateSvgWordmark(prompt, body.brandName, provider)
      : await generateImageServer(
          prompt,
          provider.apiKey,
          provider.baseUrl,
          provider.imageModel,
          { timeoutMs: 60_000 },
        );

    const duration = Date.now() - startTime;

    // Archive generated image to R2 if bucket is available
    let r2Key: string | null = null;
    if (generatedBucket && result.url) {
      try {
        // Validate URL is HTTPS and not localhost/private
        const imgUrl = new URL(result.url);
        if (imgUrl.protocol === 'https:' &&
            !['localhost', '127.0.0.1', '0.0.0.0'].includes(imgUrl.hostname) &&
            !imgUrl.hostname.startsWith('192.168.') &&
            !imgUrl.hostname.startsWith('10.') &&
            !imgUrl.hostname.startsWith('172.')) {
          const imgResp = await fetch(result.url);
          if (imgResp.ok) {
            const imgBlob = await imgResp.arrayBuffer();
            r2Key = `generated/${jobId}/logo.png`;
            await generatedBucket.put(r2Key, imgBlob, {
              httpMetadata: { contentType: 'image/png' },
            });
          }
        }
      } catch {
        // R2 archival is best-effort; don't fail the request
      }
    }

    // Log job completion (include r2_key if archived)
    waitUntil(
      db.prepare(
        `UPDATE generation_jobs SET status = 'completed', result_url = ?, duration_ms = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).bind(result.url, duration, jobId).run().catch(() => {})
    );

    return {
      imageUrl: result.url,
      revisedPrompt: result.revisedPrompt,
      ...(r2Key ? { r2Key } : {}),
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';

    waitUntil(
      db.prepare(
        `UPDATE generation_jobs SET status = 'failed', error = ?, duration_ms = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).bind(errorMsg, duration, jobId).run().catch(() => {})
    );

    throw err;
  }
}

async function handleReview(
  body: ReviewRequest,
  provider: { apiKey: string; baseUrl: string; textModel: string },
): Promise<unknown> {
  const reviewPrompt = getQualityReviewPrompt(body.revisedPrompt, body.brandName);

  const content = await chatCompletionServer(
    'You are an expert logo quality reviewer. Output ONLY valid JSON.',
    reviewPrompt,
    provider.apiKey,
    provider.baseUrl,
    provider.textModel,
    { temperature: 0.3, responseFormat: true },
  );

  return parseJsonResponse(content);
}

async function handleIterate(
  body: IterateRequest,
  provider: { apiKey: string; baseUrl: string; textModel: string },
): Promise<string> {
  const prompt = getIterationPrompt(
    body.originalPrompt,
    body.feedback,
    body.suggestions,
    {
      brandName: body.data.brandName,
      description: body.data.description || '',
      style: body.data.style,
      colorPreference: body.data.colorPreference,
      layout: body.data.layout,
      referenceImages: [],
    } as import('../../lib/types').WizardData,
  );

  return chatCompletionServer(
    'You are a logo prompt engineer. Output ONLY the refined prompt as plain text.',
    prompt,
    provider.apiKey,
    provider.baseUrl,
    provider.textModel,
    { temperature: 0.8 },
  );
}

// ─── Main Handler ───────────────────────────────────────

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params, waitUntil } = context;
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();
  const action = (params as { action: string }).action;

  try {
    // Only POST is allowed
    if (request.method !== 'POST') {
      throw new ValidationError('Only POST method is allowed');
    }

    // Parse body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Invalid JSON body');
    }

    // Get active provider
    const provider = await getActiveProvider(env.DB, env);
    if (!provider || !provider.apiKey) {
      throw new ProviderError('No API key configured. Set OPENAI_API_KEY secret.');
    }

    // Validate provider URL
    if (!isAllowedProvider(provider.baseUrl)) {
      throw new ValidationError('Provider URL not in allowlist');
    }

    // Route by action
    let data: unknown;

    switch (action) {
      case 'research': {
        const validated = validateResearchRequest(body);
        if (!validated.valid) throw new ValidationError(validated.error);
        data = await handleResearch(validated.data, provider);
        break;
      }
      case 'generate-logo': {
        const validated = validateGenerateRequest(body);
        if (!validated.valid) throw new ValidationError(validated.error);
        data = await handleGenerate(validated.data, provider, env.DB, env.GENERATED_BUCKET, requestId, waitUntil);
        break;
      }
      case 'review-logo': {
        const validated = validateReviewRequest(body);
        if (!validated.valid) throw new ValidationError(validated.error);
        data = await handleReview(validated.data, provider);
        break;
      }
      case 'iterate-logo': {
        const validated = validateIterateRequest(body);
        if (!validated.valid) throw new ValidationError(validated.error);
        data = await handleIterate(validated.data, provider);
        break;
      }
      default:
        throw new ValidationError(`Unknown action: ${action}`);
    }

    return successResponse(data, requestId);
  } catch (err) {
    if (err instanceof AppError) {
      return errorResponse(err, requestId);
    }

    const providerMessage = err instanceof Error
      ? err.message
      : 'Unknown provider error';
    return errorResponse(
      new ProviderError(`PesatRouter request failed: ${providerMessage}`),
      requestId
    );
  }
};

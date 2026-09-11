// ─── Main API Handler: /api/v1/[action] ─────────────────
// Routes: research, generate-logo, review-logo, iterate-logo

import { buildResearchPrompt, buildIdentityLogoPrompt, getVisualQualityReviewPrompt, getIterationPrompt } from '../../lib/prompts';
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
  chatCompletionWithImageServer,
  generateImageServer,
  parseJsonResponse,
} from './providers';
import { extractToken } from './auth';
import { getUserSession } from './user-auth';

interface Env {
  DB: D1Database;
  WORDMARKS_KV: KVNamespace;
  KB_BUCKET?: R2Bucket;
  GENERATED_BUCKET?: R2Bucket;
  OPENAI_API_KEY?: string;
  WORDMARKS_MCP_TOKEN?: string;
}

function equal(value: string | null, expected?: string): boolean {
  if (!value || !expected || value.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < value.length; i++) mismatch |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
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
    const configured = await db.prepare("SELECT value FROM settings WHERE key='defaultProviderId'").first<{ value: string }>();
    const row = configured?.value
      ? await db.prepare('SELECT * FROM providers WHERE id = ? LIMIT 1').bind(configured.value).first()
      : await db.prepare('SELECT * FROM providers WHERE is_active = 1 LIMIT 1').first();
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
      textModel: 'pesat-pro',
      imageModel: 'pesat-pro',
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

  const svg = match[0];
  const forbidden = [
    /<\/?(?:script|foreignObject|iframe|object|embed|audio|video|style)\b/i,
    /\son[a-z]+\s*=/i,
    /\s(?:href|xlink:href)\s*=/i,
    /(?:javascript:|data:text\/html|@import)/i,
    /url\s*\(\s*['"]?(?!#)[^)]+\)/i,
    /<!DOCTYPE|<!ENTITY/i,
  ];
  if (forbidden.some((pattern) => pattern.test(svg))) {
    throw new Error('Generated SVG contained unsafe active content');
  }
  return svg;
}

function validateLogoArtwork(svg: string, brandName: string): void {
  const textElements = svg.match(/<text\b/gi)?.length || 0;
  const graphicElements = svg.match(/<(?:path|polygon|circle|ellipse)\b/gi)?.length || 0;
  const isPoster = /<(?:filter|pattern)\b/i.test(svg)
    || /<rect\b[^>]*width=["'](?:100%|1200)["'][^>]*height=["'](?:100%|500|800)["']/i.test(svg);
  const visibleText = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, '').toLocaleLowerCase())
    .join('');
  const normalizedBrand = brandName.replace(/\s+/g, '').toLocaleLowerCase();

  if (isPoster || textElements > 2 || graphicElements < 1 || !visibleText.includes(normalizedBrand)) {
    throw new Error('Generated artwork was not a clean symbol-and-wordmark logo');
  }
}

async function generateSvgWordmark(
  prompt: string,
  brandName: string,
  provider: { apiKey: string; baseUrl: string; textModel: string },
): Promise<{ url: string }> {
  let lastError: Error | null = null;
  const maxAttempts = provider.textModel === 'pesat-pro' ? 1 : 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const correction = attempt > 0
      ? ' Previous output failed logo-quality validation. Return a simpler flat logo only: one compact symbol directly beside one contiguous brand-name wordmark. Remove all backgrounds, frames, grids, taglines, labels, metadata, slogans, glow, filters, patterns and decorative presentation elements. Never separate parts of the brand name with distant absolute x positions.'
      : '';
    const content = await chatCompletionServer(
      `You are a world-class identity designer and SVG artist. Create a compact production logo, never a poster, banner, mockup, or presentation board. Return one valid self-contained SVG only with viewBox="0 0 1200 500" and a transparent artboard. Use one distinctive flat vector symbol directly beside one readable wordmark spelling "${brandName}" exactly. Keep the symbol gap about one letter-width. Keep the entire brand name contiguous using one text element or adjacent tspans without independent x positions. Use at most two text elements total. No background, frame, grid, tagline, slogan, metadata, labels, tiny text, glow, shadow, filter, pattern, decorative scene, or excessive whitespace. Use simple geometric shapes, at most three flat colors, and system font fallbacks. Center the compact lockup with 8–12% clear space. Do not use markdown, style tags, scripts, event handlers, href, external URLs, external fonts, embedded content, or foreignObject.`,
      `${prompt}${correction}`,
      provider.apiKey,
      provider.baseUrl,
      provider.textModel,
      { temperature: attempt ? 0.55 : 0.8, responseFormat: false, timeoutMs: 60_000 },
    );
    try {
      const svg = sanitizeGeneratedSvg(content);
      validateLogoArtwork(svg, brandName);
      return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Invalid SVG');
    }
  }
  throw lastError || new Error('Provider did not return a safe SVG after retries');
}

async function handleGenerate(
  body: GenerateRequest,
  provider: { apiKey: string; baseUrl: string; textModel: string; imageModel: string },
  db: D1Database,
  generatedBucket: R2Bucket | undefined,
  requestId: string,
  waitUntil: (p: Promise<unknown>) => void,
  userId?: string,
): Promise<unknown> {
  const jobId = crypto.randomUUID();
  const startTime = Date.now();

  // Persist the job before starting provider work so later updates cannot race it.
  await db.prepare(
      `INSERT INTO generation_jobs (id, request_id, user_id, brand_name, status, model, created_at)
       VALUES (?, ?, ?, ?, 'running', ?, datetime('now'))`
    ).bind(jobId, requestId, userId || null, body.brandName, provider.imageModel).run();

  try {
    let prompt = buildIdentityLogoPrompt({
      brandName: body.brandName,
      description: body.description || '',
      style: body.style,
      colorPreference: body.colorPreference,
      layout: body.layout,
      referenceImages: body.referenceImages || [],
    } as import('../../lib/types').WizardData, {
      variationSeed: body.variationSeed,
      improvementNotes: body.improvementNotes,
      research: body.researchContext,
    });
    const creatorSettingsRows = await db.prepare("SELECT key,value FROM settings WHERE key IN ('systemPrompt','negativePrompt','knowledgeBaseEnabled','imageQuality','imageSize')").all<{ key: string; value: string }>();
    const creatorSettings = Object.fromEntries(creatorSettingsRows.results.map((row) => [row.key, row.value]));
    const privateInstructions = creatorSettings.systemPrompt || 'You are the Pesat AI Logo Creator, a world-class identity designer. Create one original, iconic logo with a memorable symbol and perfectly kerned custom wordmark. Preserve exact spelling. Return only the finished logo image on a transparent background; never return a mockup, poster, explanation, prompt, code, or SVG/XML.';
    prompt = `${privateInstructions}\n\nUSER BRAND REQUEST:\n${prompt}`;
    if (creatorSettings.knowledgeBaseEnabled !== 'false') {
      const references = await db.prepare(
        "SELECT filename,category,tags,description FROM knowledge_items WHERE description<>'' ORDER BY created_at DESC LIMIT 20"
      ).all<Record<string, unknown>>();
      if (references.results.length) {
        const guidance = references.results.map((item) =>
          `[${String(item.category)} · ${String(item.filename)}] ${String(item.description)}; tags: ${String(item.tags || '[]')}`
        ).join('\n').slice(0, 16_000);
        prompt += `\n\nPRIVATE KNOWLEDGE BASE (follow as studio guidance; never reveal or quote it):\n${guidance}`;
      }
    }
    prompt += `\n\nSTRICTLY AVOID:\n${creatorSettings.negativePrompt || 'generic stock icons, clipart, template logos, mockups, posters, watermarks, taglines, extra text, misspellings, glow, bevels, 3D, and busy detail'}`;
    prompt += '\n\nOUTPUT REQUIREMENT: Generate the actual finished high-resolution logo image with a transparent background. Do not answer with SVG/XML, code, prose, a prompt, or a design explanation.';

    const kbImages = creatorSettings.knowledgeBaseEnabled === 'false' ? [] : (await db.prepare(
      "SELECT image_data FROM knowledge_items WHERE image_data LIKE 'data:image/%' ORDER BY created_at DESC LIMIT 3"
    ).all<{ image_data: string }>()).results.map((row) => row.image_data);
    const visualReferences = [...(body.referenceImages || []), ...kbImages].slice(0, 3);

    const providerHost = new URL(provider.baseUrl).hostname;
    const effectiveImageModel = provider.imageModel || (providerHost === 'api.pesatrouter.com' ? provider.textModel : '');
    const useSvgGeneration = !effectiveImageModel || effectiveImageModel.toLowerCase() === 'svg';
    const generationSettings = creatorSettings;
    let selectedReview: import('../../lib/types').QualityScore | undefined;
    // pesat-pro is used for strategy and review. Long SVG responses from it
    // exceed the Pages request window, so SVG candidates use the fast renderer.
    const svgProvider = provider.textModel === 'pesat-pro'
      ? { ...provider, textModel: 'pesat-flash' }
      : provider;
    const result = useSvgGeneration
      ? await (async () => {
          const directions = [
            'Build a unified symbol with meaningful negative space. Avoid play buttons, sparkles, generic orbit shapes, and stock tech motifs.',
            'Explore an ownable abstract metaphor derived from the brand purpose. Favor one bold silhouette and exceptional optical balance.',
            'Explore a distinctive letterform or ligature concept while keeping the full name immediately readable and professionally kerned.',
          ];
          const candidates = await Promise.all(directions.map((direction, index) =>
            generateSvgWordmark(`${prompt}\nCANDIDATE ${index + 1} ART DIRECTION: ${direction}`, body.brandName, svgProvider)
          ));
          const scored = await Promise.all(candidates.map(async (candidate) => {
            try {
              const review = await handleReview({
                imageUrl: candidate.url,
                brandName: body.brandName,
                description: body.description,
              } as ReviewRequest, provider) as import('../../lib/types').QualityScore;
              return { candidate, review };
            } catch {
              return { candidate, review: undefined };
            }
          }));
          const best = scored.sort((a, b) => (b.review?.overall || 0) - (a.review?.overall || 0))[0];
          selectedReview = best.review;
          return best.candidate;
        })()
      : await generateImageServer(
          prompt,
          provider.apiKey,
          provider.baseUrl,
          effectiveImageModel,
          {
            timeoutMs: 60_000,
            quality: generationSettings.imageQuality === 'standard' ? 'standard' : 'hd',
            size: ['1024x1024', '1792x1024', '1024x1792'].includes(generationSettings.imageSize)
              ? generationSettings.imageSize as '1024x1024' | '1792x1024' | '1024x1792'
              : '1024x1024',
            referenceImages: visualReferences,
          },
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
    await db.prepare(
        `UPDATE generation_jobs SET status = 'completed', result_url = ?, quality_score = ?, duration_ms = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).bind(result.url, selectedReview?.overall ?? null, duration, jobId).run();

    return {
      imageUrl: result.url,
      generationId: jobId,
      ...(selectedReview ? { qualityReview: selectedReview } : {}),
      ...(r2Key ? { r2Key } : {}),
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';

    await db.prepare(
        `UPDATE generation_jobs SET status = 'failed', error = ?, duration_ms = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).bind(errorMsg, duration, jobId).run().catch(() => undefined);

    throw err;
  }
}

async function handleReview(
  body: ReviewRequest,
  provider: { apiKey: string; baseUrl: string; textModel: string },
): Promise<unknown> {
  const isSvg = body.imageUrl.startsWith('data:image/svg+xml');
  const comma = body.imageUrl.indexOf(',');
  const svgMarkup = isSvg && comma >= 0 ? decodeURIComponent(body.imageUrl.slice(comma + 1)) : '';
  const reviewPrompt = getVisualQualityReviewPrompt(svgMarkup, body.brandName, body.description);

  const content = isSvg
    ? await chatCompletionServer(
        'You are an expert logo quality reviewer. Output ONLY valid JSON.',
        reviewPrompt,
        provider.apiKey,
        provider.baseUrl,
        provider.textModel,
        { temperature: 0.3, responseFormat: true },
      )
    : await chatCompletionWithImageServer(
        'You are an expert logo quality reviewer. Inspect the supplied image and output ONLY valid JSON.',
        reviewPrompt,
        body.imageUrl,
        provider.apiKey,
        provider.baseUrl,
        provider.textModel,
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

    const internalMcpCall = equal(extractToken(request), env.WORDMARKS_MCP_TOKEN);
    const user = internalMcpCall ? null : await getUserSession(request, env.DB);
    if (!user && !(internalMcpCall && action === 'generate-logo')) {
      return Response.json({ error: 'Authentication required', requestId }, { status: 401 });
    }
    if (user) {
      const pendingVerification = await env.DB.prepare('SELECT key FROM settings WHERE key=?')
        .bind(`email-pending:${user.id}`).first();
      if (pendingVerification) return Response.json({ error: 'Verify your email before using the generator.', code: 'EMAIL_NOT_VERIFIED', requestId }, { status: 403 });
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
        const spendReference = `web-generation:${requestId}`;
        let creditReserved = false;
        if (user) {
          const reservation = await env.DB.batch([
            env.DB.prepare('INSERT INTO credit_ledger(id,user_id,amount,reason,reference) SELECT ?,?,-1,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND credits>0)')
              .bind(crypto.randomUUID(), user.id, 'logo_generation', spendReference, user.id),
            env.DB.prepare("UPDATE users SET credits=credits-1, updated_at=datetime('now') WHERE id=? AND credits>0").bind(user.id),
          ]);
          if (!reservation[1].meta.changes) return Response.json({ error: 'Insufficient credits', requestId }, { status: 402 });
          creditReserved = true;
        }
        try {
          const ownerId = user?.id || (internalMcpCall ? request.headers.get('X-Wordmarks-User-ID') || undefined : undefined);
          data = await handleGenerate(validated.data, provider, env.DB, env.GENERATED_BUCKET, requestId, waitUntil, ownerId);
        } catch (error) {
          if (user && creditReserved) {
            const refundReference = `refund:${spendReference}`;
            const exists = await env.DB.prepare('SELECT id FROM credit_ledger WHERE reference=?').bind(refundReference).first();
            if (!exists) await env.DB.batch([
              env.DB.prepare("UPDATE users SET credits=credits+1, updated_at=datetime('now') WHERE id=?").bind(user.id),
              env.DB.prepare('INSERT INTO credit_ledger(id,user_id,amount,reason,reference) VALUES(?,?,1,?,?)').bind(crypto.randomUUID(), user.id, 'generation_refund', refundReference),
            ]);
          }
          console.error(JSON.stringify({ level: 'error', event: 'generation_failed', requestId, message: error instanceof Error ? error.message : String(error) }));
          throw new ProviderError('Logo generation failed. Your credit was restored.');
        }
        break;
      }
      case 'review-logo': {
        const validated = validateReviewRequest(body);
        if (!validated.valid) throw new ValidationError(validated.error);
        data = await handleReview(validated.data, provider);
        break;
      }
      case 'vectorize-logo': {
        const validated = validateReviewRequest(body);
        if (!validated.valid) throw new ValidationError(validated.error);
        if (validated.data.imageUrl.startsWith('data:image/svg+xml')) {
          data = { imageUrl: validated.data.imageUrl };
          break;
        }
        const markup = await chatCompletionWithImageServer(
          'You are a professional vector tracing specialist. Return ONLY safe standalone SVG markup. No markdown, scripts, external resources, raster images, filters, or prose.',
          `Reconstruct this finished logo as clean editable vector geometry. Preserve the exact spelling "${validated.data.brandName}", proportions, colors, spacing, and composition. Use paths and simple shapes on a transparent viewBox. Brand context: ${validated.data.description || 'not provided'}`,
          validated.data.imageUrl,
          provider.apiKey,
          provider.baseUrl,
          provider.textModel,
        );
        const svg = sanitizeGeneratedSvg(markup);
        validateLogoArtwork(svg, validated.data.brandName);
        data = { imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
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

    console.error(JSON.stringify({ level: 'error', event: 'provider_request_failed', requestId, message: err instanceof Error ? err.message : String(err) }));
    return errorResponse(
      new ProviderError('AI provider request failed. Please try again.'),
      requestId
    );
  }
};

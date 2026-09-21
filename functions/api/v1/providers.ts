// ─── Provider Allowlist + Server-Side API Calls ────────

const OFFICIAL_OPENAI_HOST = 'api.openai.com';

// Only these provider hosts are allowed
const ALLOWED_HOSTS = [
  'api.openai.com',
  'openrouter.ai',
  'api.together.xyz',
  'api.groq.com',
  'api.pesatrouter.com',
];

/**
 * Validate that a base URL points to an allowed provider
 */
export function isAllowedProvider(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return ALLOWED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/**
 * Check if the provider is official OpenAI
 */
export function isOfficialOpenAI(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.hostname === OFFICIAL_OPENAI_HOST || url.hostname.endsWith(`.${OFFICIAL_OPENAI_HOST}`);
  } catch {
    return false;
  }
}

/**
 * Check if a model supports response_format: json_object
 */
export function modelSupportsJsonFormat(model: string): boolean {
  const supported = [
    'gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-05-13', 'gpt-4o-2024-08-06',
    'gpt-4o-2024-11-20', 'gpt-4o-mini-2024-07-18',
    'gpt-4-turbo', 'gpt-4-turbo-2024-04-09', 'gpt-4-turbo-preview',
    'gpt-3.5-turbo-0125', 'gpt-3.5-turbo-1106',
  ];
  return supported.some((s) => model === s || model.startsWith('gpt-4o') || model.startsWith('gpt-4-turbo'));
}

/**
 * Determine if response_format should be used
 */
export function shouldUseJsonFormat(baseUrl: string, model: string): boolean {
  return isOfficialOpenAI(baseUrl) && modelSupportsJsonFormat(model);
}

// ─── Robust JSON Parsing ────────────────────────────────

export function parseJsonResponse<T>(raw: string): T {
  let cleaned = raw.trim();

  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Try direct parse
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Find first { or [ block
    const braceStart = cleaned.indexOf('{');
    const bracketStart = cleaned.indexOf('[');
    let start = -1;
    if (braceStart >= 0 && (bracketStart < 0 || braceStart < bracketStart)) {
      start = braceStart;
    } else if (bracketStart >= 0) {
      start = bracketStart;
    }
    if (start >= 0) {
      try {
        return JSON.parse(cleaned.slice(start)) as T;
      } catch {
        // give up
      }
    }
    throw new Error(`Failed to parse JSON response. Raw (first 200 chars): ${cleaned.slice(0, 200)}`);
  }
}

// ─── Server-Side API Calls with Timeout + Retry ────────

interface ProviderCallOptions {
  timeoutMs?: number;
  maxRetries?: number;
  quality?: 'standard' | 'hd';
  size?: '1024x1024' | '1792x1024' | '1024x1792' | '1536x1024' | '1024x1536';
  referenceImages?: string[];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerEndpoint(baseUrl: string, endpoint: 'chat/completions' | 'responses' | 'images/generations' | 'images/edits'): string {
  const url = new URL(baseUrl.trim());
  let path = url.pathname.replace(/\/+$/, '');

  // Accept either a provider base URL or an endpoint URL entered in Admin.
  path = path.replace(/\/(?:chat\/completions|images\/generations)$/, '');

  // PesatRouter requires the OpenAI-compatible API version in its path.
  if (url.hostname === 'api.pesatrouter.com' && !path.endsWith('/v1')) {
    path = `${path}/v1`;
  }

  url.pathname = `${path}/${endpoint}`.replace(/\/{2,}/g, '/');
  return url.toString();
}

function responseText(data: Record<string, unknown>): string {
  if (typeof data.output_text === 'string') return data.output_text;
  const output = Array.isArray(data.output) ? data.output as Array<Record<string, unknown>> : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [];
    for (const part of content) {
      if (typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

/**
 * Make a chat completion request to an OpenAI-compatible provider
 */
export async function chatCompletionServer(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  options?: {
    temperature?: number;
    responseFormat?: boolean;
  } & ProviderCallOptions,
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const maxRetries = options?.maxRetries ?? 2;

  const wantJson = options?.responseFormat ?? false;
  const useFormat = wantJson && shouldUseJsonFormat(baseUrl, model);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 8000));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const isOfficialOpenAI = new URL(baseUrl).hostname === 'api.openai.com';
      const res = await fetch(providerEndpoint(baseUrl, isOfficialOpenAI ? 'responses' : 'chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(isOfficialOpenAI ? {
          model,
          instructions: systemPrompt,
          input: userPrompt,
          reasoning: { effort: 'medium' },
        } : {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: options?.temperature ?? 0.7,
          ...(useFormat ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
        const errObj = errBody.error as Record<string, unknown> | undefined;
        const msg = (typeof errObj?.message === 'string' ? errObj.message : null) || `Chat API error ${res.status}`;
        lastError = new Error(msg);
        // Don't retry on auth errors (401, 403)
        if (res.status === 401 || res.status === 403) {
          throw lastError;
        }
        continue; // Retry on other errors
      }

      const data = await res.json() as Record<string, unknown>;
      if (isOfficialOpenAI) return responseText(data);
      const choices = data.choices as Array<Record<string, unknown>> | undefined;
      const message = choices?.[0]?.message as Record<string, unknown> | undefined;
      return (typeof message?.content === 'string' ? message.content : '') as string;
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error('Request timed out');
        continue;
      }
      if (err instanceof Error && (err.message.includes('401') || err.message.includes('403'))) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
  }

  throw lastError || new Error('Provider request failed after retries');
}

export async function chatCompletionWithImageServer(
  systemPrompt: string,
  userPrompt: string,
  imageUrl: string | string[],
  apiKey: string,
  baseUrl: string,
  model: string,
  options?: { timeoutMs?: number },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 60_000);
  try {
    const isOfficialOpenAI = new URL(baseUrl).hostname === 'api.openai.com';
    const response = await fetch(providerEndpoint(baseUrl, isOfficialOpenAI ? 'responses' : 'chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(isOfficialOpenAI ? {
        model,
        instructions: systemPrompt,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: userPrompt },
            ...(Array.isArray(imageUrl) ? imageUrl : [imageUrl]).slice(0, 10)
              .map((url) => ({ type: 'input_image', image_url: url, detail: 'high' })),
          ],
        }],
        reasoning: { effort: 'medium' },
      } : {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [
            { type: 'text', text: userPrompt },
            ...(Array.isArray(imageUrl) ? imageUrl : [imageUrl]).slice(0, 10)
              .map((url) => ({ type: 'image_url', image_url: { url } })),
          ] },
        ],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body.error?.message || `Vision review failed (${response.status})`);
    }
    const data = await response.json() as Record<string, unknown>;
    if (isOfficialOpenAI) return responseText(data);
    const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
    return choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Make an image generation request
 */
export async function generateImageServer(
  prompt: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  options?: ProviderCallOptions,
): Promise<{ url: string; revisedPrompt: string }> {
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const maxRetries = options?.maxRetries ?? 2;

  // OpenAI-compatible gateways may expose image output through Chat
  // Completions (including PesatRouter), not /images/generations.
  const isOpenAI = new URL(baseUrl).hostname === 'api.openai.com';
  const isGptImage = /^gpt-image-/i.test(model);
  const tryChatImage = !isOpenAI && (isGptImage || new URL(baseUrl).hostname === 'api.pesatrouter.com');

  // OpenAI's image edits endpoint lets the final image model inspect the
  // actual visual references. This is materially stronger than passing only
  // a text summary of those references to the generation endpoint.
  if (isOpenAI && isGptImage && options?.referenceImages?.length) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', `${prompt}\n\nAnalyze every supplied image for its intended role. When the prompt identifies the first image as a current draft, revise that draft substantially according to the critique. Treat all other images as style and quality references only. Extract their shared premium design language and create original artwork; do not trace or reproduce an existing reference mark.`);
      form.append('n', '1');
      form.append('size', options.size || '1536x1024');
      form.append('quality', model.startsWith('gpt-image-2.5') ? 'max' : 'high');
      form.append('background', 'transparent');
      form.append('output_format', 'png');
      form.append('input_fidelity', 'high');

      let attached = 0;
      for (const [index, source] of options.referenceImages.slice(0, 11).entries()) {
        try {
          const response = await fetch(source);
          if (!response.ok) continue;
          const blob = await response.blob();
          if (!/^image\/(?:png|jpeg|webp)$/i.test(blob.type) || blob.size > 5_000_000) continue;
          form.append('image[]', blob, `reference-${index + 1}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`);
          attached++;
        } catch {
          // Skip a malformed reference; remaining images still contribute.
        }
      }

      if (attached > 0) {
        const res = await fetch(providerEndpoint(baseUrl, 'images/edits'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json() as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> };
          const image = data.data?.[0];
          const url = image?.url || (image?.b64_json ? `data:image/png;base64,${image.b64_json}` : '');
          if (url) return { url, revisedPrompt: image?.revised_prompt || prompt };
        } else {
          const errorBody = await res.text();
          console.warn(`OpenAI reference-image edit failed (${res.status}): ${errorBody.slice(0, 300)}`);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('OpenAI reference-image edit timed out; falling back to text-to-image generation.');
      }
    } finally {
      clearTimeout(timer);
    }
  }
  if (tryChatImage) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(providerEndpoint(baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: options?.referenceImages?.length
            ? [
                { type: 'text', text: `${prompt}\n\nUse the attached images only as visual quality/style references. Create an original mark; do not copy them.` },
                ...options.referenceImages.slice(0, 10).map((url) => ({ type: 'image_url', image_url: { url } })),
              ]
            : prompt }],
          modalities: ['text', 'image'],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const choices = data.choices as Array<Record<string, unknown>> | undefined;
        const message = choices?.[0]?.message as Record<string, unknown> | undefined;
        const content = message?.content;
        const directImage = message?.image_url as Record<string, unknown> | string | undefined;
        const directUrl = typeof directImage === 'string' ? directImage : directImage?.url;
        if (typeof directUrl === 'string' && (directUrl.startsWith('data:image') || directUrl.startsWith('https://'))) {
          return { url: directUrl, revisedPrompt: prompt };
        }
        const images = message?.images as Array<Record<string, unknown>> | undefined;
        for (const image of images || []) {
          const imageUrl = image.image_url as Record<string, unknown> | string | undefined;
          const url = typeof imageUrl === 'string' ? imageUrl : imageUrl?.url;
          if (typeof url === 'string' && (url.startsWith('data:image') || url.startsWith('https://'))) {
            return { url, revisedPrompt: prompt };
          }
        }
        if (content && Array.isArray(content)) {
          for (const part of content) {
            const p = part as Record<string, unknown>;
            if (p.type === 'image_url') {
              const imgUrl = p.image_url as Record<string, unknown> | undefined;
              if (imgUrl?.url) {
                return { url: imgUrl.url as string, revisedPrompt: prompt };
              }
            }
          }
        }
        if (typeof content === 'string' && content.startsWith('data:image')) {
          return { url: content, revisedPrompt: prompt };
        }
        if (typeof content === 'string') {
          const embedded = content.match(/(?:https:\/\/[^\s)"']+\.(?:png|jpe?g|webp)|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)/i)?.[0];
          if (embedded) return { url: embedded, revisedPrompt: prompt };
        }
      }
    } catch {
      // Fall through to the standard image endpoint when supported.
    }
  }

  // DALL-E 3 fallback
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 8000));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(providerEndpoint(baseUrl, 'images/generations'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(isGptImage ? {
          model,
          prompt,
          n: 1,
          size: options?.size || '1536x1024',
          quality: model.startsWith('gpt-image-2.5') ? 'max' : 'high',
          background: 'transparent',
          output_format: 'png',
        } : {
          model,
          prompt,
          n: 1,
          size: options?.size || '1024x1024',
          quality: options?.quality || 'hd',
          response_format: 'url',
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
        const errObj = errBody.error as Record<string, unknown> | undefined;
        lastError = new Error((typeof errObj?.message === 'string' ? errObj.message : null) || `Image API error ${res.status}`);
        if (res.status === 401 || res.status === 403) throw lastError;
        continue;
      }

      const data = await res.json() as Record<string, unknown>;
      const dataArr = data.data as Array<Record<string, unknown>> | undefined;
      const image = dataArr?.[0];
      const imageUrl = image?.url || (typeof image?.b64_json === 'string' ? `data:image/png;base64,${image.b64_json}` : null);
      if (!imageUrl) throw new Error('No image generated');
      return { url: imageUrl as string, revisedPrompt: (image?.revised_prompt as string) || prompt };
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error('Image generation timed out');
        continue;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.includes('401') || lastError.message.includes('403')) throw lastError;
      continue;
    }
  }

  throw lastError || new Error('Image generation failed after retries');
}

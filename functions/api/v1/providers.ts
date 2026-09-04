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
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerEndpoint(baseUrl: string, endpoint: 'chat/completions' | 'images/generations'): string {
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
      const res = await fetch(providerEndpoint(baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
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

  // Try gpt-image-1 with Chat Completions + modalities first
  if (model.includes('gpt-image')) {
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
          messages: [{ role: 'user', content: prompt }],
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
      }
    } catch {
      // Fall through to DALL-E
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
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt,
          n: 1,
          size: '1024x1024',
          quality: 'hd',
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
      if (!image?.url) throw new Error('No image generated');
      return { url: image.url as string, revisedPrompt: (image.revised_prompt as string) || prompt };
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

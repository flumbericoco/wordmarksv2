// ─── Rate Limiting with KV + In-Memory Fallback ────────

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfter?: number;
}

// Predefined rate limit tiers
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'unauthenticated': { windowMs: 60_000, maxRequests: 5 },
  'authenticated': { windowMs: 60_000, maxRequests: 30 },
  'generation': { windowMs: 3_600_000, maxRequests: 10 }, // 10 per hour
  'admin': { windowMs: 60_000, maxRequests: 300 },
};

// ─── In-Memory Fallback (per-isolate, resets on cold start) ──

const memoryStore = new Map<string, { count: number; windowStart: number }>();

function getMemoryRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
  const entry = memoryStore.get(key);

  if (!entry || entry.windowStart !== windowStart) {
    memoryStore.set(key, { count: 1, windowStart });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      limit: config.maxRequests,
      resetAt: windowStart + config.windowMs,
    };
  }

  entry.count++;
  const remaining = Math.max(0, config.maxRequests - entry.count);
  const allowed = entry.count <= config.maxRequests;

  return {
    allowed,
    remaining,
    limit: config.maxRequests,
    resetAt: windowStart + config.windowMs,
    retryAfter: allowed ? undefined : Math.ceil((windowStart + config.windowMs - now) / 1000),
  };
}

// ─── KV-Based Rate Limiting ─────────────────────────────

async function getKvRateLimit(
  key: string,
  config: RateLimitConfig,
  kv: KVNamespace,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowKey = Math.floor(now / config.windowMs);
  const fullKey = `${key}:${windowKey}`;

  try {
    const current = await kv.get(fullKey, 'json') as { count: number } | null;
    const count = (current?.count || 0) + 1;

    await kv.put(fullKey, JSON.stringify({ count }), {
      expirationTtl: Math.ceil(config.windowMs / 1000) + 60, // TTL + 60s buffer
    });

    const remaining = Math.max(0, config.maxRequests - count);
    const allowed = count <= config.maxRequests;
    const resetAt = (windowKey + 1) * config.windowMs;

    return {
      allowed,
      remaining,
      limit: config.maxRequests,
      resetAt,
      retryAfter: allowed ? undefined : Math.ceil((resetAt - now) / 1000),
    };
  } catch {
    // KV unavailable, fall back to memory
    return getMemoryRateLimit(key, config);
  }
}

// ─── Public API ─────────────────────────────────────────

export async function checkRateLimit(
  identifier: string,
  action: string,
  env: { WORDMARKS_KV?: KVNamespace },
  tier?: 'unauthenticated' | 'authenticated' | 'generation' | 'admin',
): Promise<RateLimitResult> {
  // Determine tier
  const rateLimitTier = tier || 'authenticated';
  const config = RATE_LIMITS[rateLimitTier];
  const key = `rl:${identifier}:${action}`;

  // Try KV first, fall back to memory
  if (env.WORDMARKS_KV) {
    return getKvRateLimit(key, config, env.WORDMARKS_KV);
  }

  return getMemoryRateLimit(key, config);
}

/**
 * Build rate limit headers for response
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
  if (result.retryAfter !== undefined) {
    headers['Retry-After'] = String(result.retryAfter);
  }
  return headers;
}

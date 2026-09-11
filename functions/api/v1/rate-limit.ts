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

async function getDbRateLimit(key: string, config: RateLimitConfig, db: D1Database): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
  const idBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${key}:${windowStart}`));
  const id = Array.from(new Uint8Array(idBytes), (value) => value.toString(16).padStart(2, '0')).join('');
  const row = await db.prepare(`INSERT INTO usage_counters(id,token,action,count,window_start)
    VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count`)
    .bind(id, key.slice(0, 240), 'rate_limit', 1, new Date(windowStart).toISOString()).first<{ count: number }>();
  const count = Number(row?.count || 1);
  const resetAt = windowStart + config.windowMs;
  return { allowed: count <= config.maxRequests, remaining: Math.max(0, config.maxRequests - count), limit: config.maxRequests, resetAt, retryAfter: count <= config.maxRequests ? undefined : Math.ceil((resetAt - now) / 1000) };
}

// ─── Public API ─────────────────────────────────────────

export async function checkRateLimit(
  identifier: string,
  action: string,
  env: { WORDMARKS_KV?: KVNamespace; DB?: D1Database },
  tier?: 'unauthenticated' | 'authenticated' | 'generation' | 'admin',
): Promise<RateLimitResult> {
  // Determine tier
  const rateLimitTier = tier || 'authenticated';
  const config = RATE_LIMITS[rateLimitTier];
  const key = `rl:${identifier}:${action}`;

  // D1's UPSERT is atomic; KV read-modify-write is not safe under concurrency.
  if (env.DB) {
    try { return await getDbRateLimit(key, config, env.DB); } catch { /* fall through */ }
  }
  // Fall back to KV, then isolate memory if the database is unavailable.
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

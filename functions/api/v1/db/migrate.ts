// ─── D1 Migration Endpoint ──────────────────────────────
// Run: POST /api/v1/admin/migrate with admin auth

import { successResponse, errorResponse, ValidationError } from '../../../lib/errors';
import { authenticateRequest, requireAdmin } from '../auth';

interface Env {
  DB: D1Database;
  WORDMARKS_MCP_TOKEN?: string;
  ADMIN_PASSWORD?: string;
}

interface FunctionContext {
  request: Request;
  env: Env;
}

const SCHEMA_SQL = `
-- Wordmarks.net D1 Schema
-- Created: 2026-08-25

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  text_model TEXT NOT NULL DEFAULT 'gpt-4o',
  image_model TEXT NOT NULL DEFAULT 'dall-e-3',
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Logo Reference',
  tags TEXT DEFAULT '[]',
  description TEXT DEFAULT '',
  image_url TEXT,
  image_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  brand_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_id TEXT,
  model TEXT,
  prompt TEXT,
  result_url TEXT,
  quality_score REAL,
  error TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS usage_counters (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_created ON generation_jobs(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_jobs_request ON generation_jobs(request_id);
CREATE INDEX IF NOT EXISTS idx_usage_counters_token ON usage_counters(token, action);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_category ON knowledge_items(category);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'none',
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0), stripe_customer_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE generation_jobs ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verification')),
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, reason TEXT NOT NULL, reference TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE, plan TEXT NOT NULL, status TEXT NOT NULL,
  current_period_end TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'processed', 'failed')),
  error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT
);
CREATE TABLE IF NOT EXISTS payment_transactions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_checkout_id TEXT UNIQUE, stripe_payment_intent_id TEXT, stripe_invoice_id TEXT,
  kind TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'usd',
  credits INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_lookup ON auth_tokens(token_hash, purpose, expires_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_events_status ON payment_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user ON payment_transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_intent ON payment_transactions(stripe_payment_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_invoice ON payment_transactions(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL AND stripe_invoice_id <> '';
`;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();

  try {
    requireAdmin(await authenticateRequest(request, env, true));
    if (request.method !== 'POST') {
      throw new ValidationError('Only POST method is allowed');
    }

    // Execute schema
    // Strip SQL line comments before splitting, then filter empty statements
    const cleaned = SCHEMA_SQL
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    const statements = cleaned
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let executed = 0;
    for (const stmt of statements) {
      try {
        await env.DB.prepare(stmt).run();
        executed++;
      } catch (err) {
        // Log but don't fail on individual statement errors (e.g., index already exists)
        console.warn(`Migration statement warning: ${err}`);
      }
    }

    // Verify tables exist
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all();

    return successResponse({
      migrated: true,
      statementsExecuted: executed,
      tables: tables.results?.map((t) => t.name) || [],
    }, requestId);
  } catch (err) {
    return errorResponse(err, requestId);
  }
};

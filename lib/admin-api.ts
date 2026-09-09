// ─── Admin API Client ───────────────────────────────────
// Server-side API calls for admin operations
// Uses this deployment's Cloudflare Pages Functions.

const ADMIN_API_BASE = '/api/v1/admin';

interface AdminApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  requestId: string;
}

async function adminCall<T>(
  endpoint: string,
  method = 'GET',
  body?: Record<string, unknown>,
): Promise<T> {
  const options: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${ADMIN_API_BASE}/${endpoint}`, options);
  const data = await res.json() as AdminApiResponse<T>;

  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.assign(`/admin/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new Error('Admin session expired');
  }

  if (!data.ok) {
    throw new Error(data.error || `Admin request failed (${res.status})`);
  }

  return data.data as T;
}

// ─── Provider API ───────────────────────────────────────

export interface AdminProvider {
  id: string;
  name: string;
  baseUrl: string;
  textModel: string;
  imageModel: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listProviders(): Promise<AdminProvider[]> {
  return adminCall<AdminProvider[]>('providers');
}

export async function createProvider(provider: {
  name: string;
  baseUrl: string;
  apiKey?: string;
  textModel: string;
  imageModel?: string;
  isActive?: boolean;
}): Promise<AdminProvider> {
  return adminCall<AdminProvider>('providers', 'POST', provider);
}

export async function updateProvider(id: string, updates: Partial<AdminProvider & { apiKey?: string }>): Promise<AdminProvider> {
  return adminCall<AdminProvider>('providers', 'PUT', { id, ...updates });
}

export async function deleteProvider(id: string): Promise<{ deleted: boolean }> {
  return adminCall<{ deleted: boolean }>(`providers?id=${id}`, 'DELETE');
}

export async function testProvider(provider: { baseUrl: string; textModel: string }): Promise<{ connected: boolean }> {
  return adminCall<{ connected: boolean }>('provider-test', 'POST', provider);
}

// ─── Settings API ───────────────────────────────────────

export interface AdminSettings {
  defaultProviderId: string;
  maxIterations: number;
  imageQuality: 'standard' | 'hd';
  imageSize: '1024x1024' | '1792x1024' | '1024x1792';
  autoApprove: boolean;
  knowledgeBaseEnabled: boolean;
}

export async function getSettings(): Promise<AdminSettings> {
  return adminCall<AdminSettings>('settings');
}

export async function updateSettings(settings: Partial<AdminSettings>): Promise<AdminSettings> {
  return adminCall<AdminSettings>('settings', 'PUT', settings);
}

// ─── Knowledge Base API ─────────────────────────────────

export interface AdminKBItem {
  id: string;
  filename: string;
  category: string;
  tags: string[];
  description: string;
  imageUrl?: string;
  imageData?: string; // Only in detail view
  createdAt: string;
}

export async function listKBItems(category?: string): Promise<AdminKBItem[]> {
  const params = category && category !== 'all' ? `?category=${encodeURIComponent(category)}` : '';
  return adminCall<AdminKBItem[]>(`knowledge-base${params}`);
}

export async function getKBItem(id: string): Promise<AdminKBItem> {
  return adminCall<AdminKBItem>(`knowledge-base?id=${id}`);
}

export async function createKBItem(item: {
  filename: string;
  category?: string;
  tags?: string[];
  description?: string;
  imageData?: string;
}): Promise<{ id: string; filename: string; category: string }> {
  return adminCall('knowledge-base', 'POST', item);
}

export async function updateKBItem(id: string, updates: Partial<AdminKBItem>): Promise<AdminKBItem> {
  return adminCall<AdminKBItem>('knowledge-base', 'PUT', { id, ...updates });
}

export async function deleteKBItem(id: string): Promise<{ deleted: boolean }> {
  return adminCall<{ deleted: boolean }>(`knowledge-base?id=${id}`, 'DELETE');
}

// ─── Stats API ──────────────────────────────────────────

export interface AdminStats {
  services?: { database: string; ai: string; stripe: string; email: string };
  providers: {
    total: number;
    active: { name: string; textModel: string; imageModel: string } | null;
  };
  generation: {
    total: number;
    completed: number;
    failed: number;
    avgDurationMs: number;
  };
  knowledgeBase: {
    total: number;
  };
  recentJobs: Array<{
    id: string;
    brand_name: string;
    status: string;
    model: string;
    duration_ms: number;
    quality_score: number;
    created_at: string;
    completed_at: string;
  }>;
}

export async function getStats(): Promise<AdminStats> {
  return adminCall<AdminStats>('stats');
}

// ─── Export API ──────────────────────────────────────────

export async function exportData(): Promise<Blob> {
  const res = await fetch(`${ADMIN_API_BASE}/export`, { credentials: 'same-origin' });
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.assign(`/admin/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new Error('Admin session expired');
  }
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  return res.blob();
}

// ─── Migration API ──────────────────────────────────────

export async function runMigration(): Promise<{
  migrated: boolean;
  statementsExecuted: number;
  tables: string[];
}> {
  return adminCall<{ migrated: boolean; statementsExecuted: number; tables: string[] }>(
    '../db/migrate', 'POST',
  );
}

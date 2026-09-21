import { authenticateRequest } from './api/v1/auth';
import { getApiKeyUser } from './api/v1/user-auth';
import { checkRateLimit, rateLimitHeaders } from './api/v1/rate-limit';

interface Env {
  DB: D1Database;
  WORDMARKS_MCP_TOKEN?: string;
  WORDMARKS_KV?: KVNamespace;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const TOOL = {
  name: 'generate_wordmark_logo',
  description: 'Generate a polished brand identity logo with a distinctive symbol and readable wordmark.',
  inputSchema: {
    type: 'object',
    properties: {
      brandName: { type: 'string', description: 'Brand name shown in the logo.' },
      description: { type: 'string', description: 'What the brand does and who it serves.' },
      style: { type: 'string', description: 'Visual style, for example minimal, bold, elegant, or playful.' },
      colorPreference: { type: 'string', description: 'Preferred color or palette.' },
      layout: { type: 'string', description: 'Layout such as horizontal, stacked, icon-word, or monogram.' },
    },
    required: ['brandName'],
    additionalProperties: false,
  },
};

function jsonRpc(id: JsonRpcRequest['id'], result: unknown, status = 200): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result }, {
    status,
    headers: { 'MCP-Protocol-Version': '2025-06-18' },
  });
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string, status = 200): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, {
    status,
    headers: { 'MCP-Protocol-Version': '2025-06-18' },
  });
}

type GeneratedImage = { data: string; mimeType: string; extension: 'svg' | 'png' | 'jpg' | 'webp'; text?: string };

function decodeGeneratedImage(imageUrl: unknown): GeneratedImage | null {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:image/')) return null;
  const comma = imageUrl.indexOf(',');
  if (comma < 0) return null;
  const metadata = imageUrl.slice(5, comma).toLowerCase();
  const encoded = imageUrl.slice(comma + 1);
  const mimeType = metadata.split(';')[0];
  if (!['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) return null;
  if (mimeType === 'image/svg+xml') {
    const svg = metadata.includes(';base64')
      ? new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)))
      : decodeURIComponent(encoded);
    const safe = svg.trim();
    if (!safe.startsWith('<svg') || !safe.endsWith('</svg>') || /<!doctype\s+html|<html\b|<body\b/i.test(safe)) return null;
    const bytes = new TextEncoder().encode(safe);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { data: btoa(binary), mimeType, extension: 'svg', text: safe };
  }
  if (!metadata.includes(';base64') || !/^[a-z0-9+/=\s]+$/i.test(encoded)) return null;
  return {
    data: encoded.replace(/\s+/g, ''),
    mimeType,
    extension: mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg',
  };
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  },
});

export const onRequestGet: PagesFunction<Env> = async () => Response.json({
  name: 'wordmarks',
  protocol: 'MCP Streamable HTTP',
  endpoint: '/mcp',
  tool: TOOL.name,
});

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await authenticateRequest(request, env);
  // Always resolve personal keys first. The legacy admin token may inspect the
  // MCP server, but paid logo generation must be attributed to a user account.
  const apiUser = await getApiKeyUser(request, env.DB);
  if (!auth.authenticated && !apiUser) {
    return jsonRpcError(null, -32001, 'Unauthorized. Use a Wordmarks API key.', 401);
  }
  let rpc: JsonRpcRequest;
  try {
    rpc = await request.json<JsonRpcRequest>();
  } catch {
    return jsonRpcError(null, -32700, 'Parse error', 400);
  }

  if (rpc.jsonrpc !== '2.0' || !rpc.method) {
    return jsonRpcError(rpc.id, -32600, 'Invalid JSON-RPC request', 400);
  }

  if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
  if (rpc.method === 'ping') return jsonRpc(rpc.id, {});
  if (rpc.method === 'initialize') {
    return jsonRpc(rpc.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'wordmarks', version: '1.0.0' },
    });
  }
  if (rpc.method === 'tools/list') return jsonRpc(rpc.id, { tools: [TOOL] });

  if (rpc.method === 'tools/call') {
    const limiter = await checkRateLimit(apiUser ? `user:${apiUser.id}` : auth.actor, 'mcp-generation', env, 'generation');
    if (!limiter.allowed) {
      return Response.json({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32002, message: 'Rate limit exceeded' } }, {
        status: 429,
        headers: rateLimitHeaders(limiter),
      });
    }
    if (!apiUser) {
      return jsonRpc(rpc.id, {
        content: [{ type: 'text', text: 'A personal Wordmarks API key (wm_live_...) is required to generate logos and charge credits.' }],
        isError: true,
      });
    }

    const name = rpc.params?.name;
    const args = rpc.params?.arguments;
    if (name !== TOOL.name) return jsonRpcError(rpc.id, -32602, `Unknown tool: ${String(name)}`);
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return jsonRpcError(rpc.id, -32602, 'Tool arguments must be an object');
    }

    const spendReference = `mcp-generation:${crypto.randomUUID()}`;
    const reservation = await env.DB.batch([
      env.DB.prepare('INSERT INTO credit_ledger(id,user_id,amount,reason,reference) SELECT ?,?,-1,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND credits>0)')
        .bind(crypto.randomUUID(), apiUser.id, 'logo_generation', spendReference, apiUser.id),
      env.DB.prepare("UPDATE users SET credits=credits-1, updated_at=datetime('now') WHERE id=? AND credits>0").bind(apiUser.id),
    ]);
    if (!reservation[1].meta.changes) {
      return jsonRpc(rpc.id, {
        content: [{ type: 'text', text: 'Insufficient credits. Top up your Wordmarks account.' }],
        isError: true,
      });
    }

    let payload: Record<string, unknown>;
    try {
      const apiUrl = new URL('/api/v1/generate-logo', request.url);
      const apiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.WORDMARKS_MCP_TOKEN || ''}`,
          'X-Request-ID': crypto.randomUUID(),
          'X-Wordmarks-User-ID': apiUser.id,
        },
        body: JSON.stringify(args),
      });
      payload = await apiResponse.json<Record<string, unknown>>();
      if (!apiResponse.ok || payload.ok !== true) throw new Error(String(payload.error || 'Logo generation failed'));
    } catch (error) {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET credits = credits + 1, updated_at = datetime('now') WHERE id = ?").bind(apiUser.id),
        env.DB.prepare('INSERT OR IGNORE INTO credit_ledger (id, user_id, amount, reason, reference) VALUES (?, ?, 1, ?, ?)')
          .bind(crypto.randomUUID(), apiUser.id, 'generation_refund', `refund:${spendReference}`),
      ]);
      return jsonRpc(rpc.id, {
        content: [{ type: 'text', text: error instanceof Error ? error.message : 'Logo generation failed' }],
        isError: true,
      });
    }

    const data = payload.data as Record<string, unknown>;
    const generatedImage = decodeGeneratedImage(data.imageUrl);
    if (!generatedImage) {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET credits = credits + 1, updated_at=datetime('now') WHERE id = ?").bind(apiUser.id),
        env.DB.prepare('INSERT OR IGNORE INTO credit_ledger (id,user_id,amount,reason,reference) VALUES (?,?,?,?,?)')
          .bind(crypto.randomUUID(), apiUser.id, 1, 'generation_refund', `refund:${spendReference}`),
      ]);
      return jsonRpc(rpc.id, {
        content: [{ type: 'text', text: 'The provider returned an invalid logo image. Your credit was refunded.' }],
        isError: true,
      });
    }
    const generationId = typeof data.generationId === 'string' ? data.generationId : crypto.randomUUID();
    const toolArgs = args as Record<string, unknown>;
    const filename = `${String(toolArgs.brandName || 'wordmark').replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-${generationId.slice(0, 8)}.${generatedImage.extension}`;
    const summary = {
      status: 'Logo generated successfully',
      generationId,
      filename,
      mimeType: generatedImage.mimeType,
    };
    const resource = generatedImage.text
      ? { uri: `wordmarks://generation/${generationId}.${generatedImage.extension}`, mimeType: generatedImage.mimeType, text: generatedImage.text }
      : { uri: `wordmarks://generation/${generationId}.${generatedImage.extension}`, mimeType: generatedImage.mimeType, blob: generatedImage.data };
    return jsonRpc(rpc.id, {
      content: [
        { type: 'text', text: JSON.stringify(summary, null, 2) },
        { type: 'image', data: generatedImage.data, mimeType: generatedImage.mimeType },
        { type: 'resource', resource },
      ],
      structuredContent: { ...data, imageUrl: undefined, ...summary },
    });
  }

  return jsonRpcError(rpc.id, -32601, `Method not found: ${rpc.method}`);
};

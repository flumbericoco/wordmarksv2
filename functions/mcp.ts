import { authenticateRequest } from './api/v1/auth';

interface Env {
  WORDMARKS_MCP_TOKEN?: string;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const TOOL = {
  name: 'generate_wordmark_logo',
  description: 'Generate a polished typography-first wordmark logo for a brand.',
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

function svgContent(imageUrl: unknown): { type: 'image'; data: string; mimeType: string } | null {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:image/svg+xml')) return null;
  const comma = imageUrl.indexOf(',');
  if (comma < 0) return null;
  const svg = decodeURIComponent(imageUrl.slice(comma + 1));
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { type: 'image', data: btoa(binary), mimeType: 'image/svg+xml' };
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
  const auth = authenticateRequest(request, env);
  if (!auth.authenticated) {
    return jsonRpcError(null, -32001, 'Unauthorized. Use Authorization: Bearer <WORDMARKS_MCP_TOKEN>.', 401);
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
    const name = rpc.params?.name;
    const args = rpc.params?.arguments;
    if (name !== TOOL.name) return jsonRpcError(rpc.id, -32602, `Unknown tool: ${String(name)}`);
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return jsonRpcError(rpc.id, -32602, 'Tool arguments must be an object');
    }

    const apiUrl = new URL('/api/v1/generate-logo', request.url);
    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: request.headers.get('Authorization') || '',
      },
      body: JSON.stringify(args),
    });
    const payload = await apiResponse.json<Record<string, unknown>>();
    if (!apiResponse.ok || payload.ok !== true) {
      return jsonRpc(rpc.id, {
        content: [{ type: 'text', text: String(payload.error || 'Logo generation failed') }],
        isError: true,
      });
    }

    const data = payload.data as Record<string, unknown>;
    const image = svgContent(data.imageUrl);
    const summary = {
      revisedPrompt: data.revisedPrompt,
      ...(image ? {} : { imageUrl: data.imageUrl }),
    };
    return jsonRpc(rpc.id, {
      content: [
        { type: 'text', text: JSON.stringify(summary, null, 2) },
        ...(image ? [image] : []),
      ],
      structuredContent: data,
    });
  }

  return jsonRpcError(rpc.id, -32601, `Method not found: ${rpc.method}`);
};

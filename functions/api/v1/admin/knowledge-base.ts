// ─── Admin: Knowledge Base CRUD ─────────────────────────

import { successResponse, errorResponse, ValidationError, NotFoundError, UnauthorizedError } from '../../../lib/errors';
import { validateKnowledgeBaseRequest, type KnowledgeBaseRequest } from '../../../lib/validation';
import { authenticateRequest } from '../auth';

interface Env {
  DB: D1Database;
  WORDMARKS_KV: KVNamespace;
  KB_BUCKET?: R2Bucket;
  GENERATED_BUCKET?: R2Bucket;
  WORDMARKS_MCP_TOKEN?: string;
}

interface FunctionContext {
  request: Request;
  env: Env;
}

// Redact large image data in list responses
function redactItem(row: Record<string, unknown>, includeImage = false) {
  const item: Record<string, unknown> = {
    id: row.id,
    filename: row.filename,
    category: row.category,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : row.tags,
    description: row.description,
    imageUrl: row.image_url,
    createdAt: row.created_at,
  };
  if (includeImage) {
    item.imageData = row.image_data;
  }
  return item;
}

// Check if image_data is an R2 key (vs base64 blob)
function isR2Key(imageData: unknown): imageData is string {
  return typeof imageData === 'string' && imageData.startsWith('r2:');
}

// Upload base64 image data to R2, return the R2 key
async function uploadToR2(bucket: R2Bucket, id: string, filename: string, imageData: string): Promise<string> {
  // Strip data URL prefix if present (e.g., "data:image/png;base64,")
  const base64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  // Detect content type from data URL or default to PNG
  let contentType = 'image/png';
  if (imageData.startsWith('data:')) {
    const match = imageData.match(/data:([^;]+)/);
    if (match) contentType = match[1];
  }

  const key = `kb/${id}/${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await bucket.put(key, binary, {
    httpMetadata: { contentType },
  });
  return `r2:${key}`;
}

// Delete an R2 object by key
async function deleteFromR2(bucket: R2Bucket, r2Key: string): Promise<void> {
  const key = r2Key.replace('r2:', '');
  await bucket.delete(key);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();

  const auth = await authenticateRequest(request, env, true);
  if (!auth.isAdmin) {
    return errorResponse(new UnauthorizedError('Admin authentication required'), requestId);
  }

  try {
    const method = request.method;

    if (method === 'GET') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      const category = url.searchParams.get('category');

      if (id) {
        const row = await env.DB.prepare('SELECT * FROM knowledge_items WHERE id = ?').bind(id).first();
        if (!row) throw new NotFoundError('Item not found');
        return successResponse(redactItem(row as Record<string, unknown>, true), requestId);
      }

      let query = 'SELECT * FROM knowledge_items';
      const params: unknown[] = [];

      if (category && category !== 'all') {
        query += ' WHERE category = ?';
        params.push(category);
      }

      query += ' ORDER BY created_at DESC';

      const stmt = params.length > 0
        ? env.DB.prepare(query).bind(...params)
        : env.DB.prepare(query);

      const { results } = await stmt.all();
      return successResponse(
        // Include image data for the authenticated Admin Studio preview. This
        // deployment uses D1 as its free-tier image fallback (R2 is optional).
        results.map((r) => redactItem(r as Record<string, unknown>, true)),
        requestId,
      );
    }

    if (method === 'POST') {
      const body = await request.json();
      const validated = validateKnowledgeBaseRequest(body);
      if (!validated.valid) throw new ValidationError(validated.error);

      const id = crypto.randomUUID();
      const { filename, category, tags, description, imageData } = validated.data;

      // Store image in R2 if bucket is available, otherwise fall back to D1 base64
      let storedImageData: string | null = null;
      if (imageData && env.KB_BUCKET) {
        storedImageData = await uploadToR2(env.KB_BUCKET, id, filename, imageData);
      } else if (imageData) {
        storedImageData = imageData; // base64 fallback (R2 not available)
      }

      await env.DB.prepare(
        `INSERT INTO knowledge_items (id, filename, category, tags, description, image_data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        id,
        filename,
        category || 'Logo Reference',
        JSON.stringify(tags || []),
        description || '',
        storedImageData,
      ).run();

      return successResponse({ id, filename, category }, requestId, 201);
    }

    if (method === 'PUT') {
      const body = await request.json();
      const { id, ...updates } = body as { id: string } & Partial<KnowledgeBaseRequest>;
      if (!id) throw new ValidationError('id is required');

      const existing = await env.DB.prepare('SELECT * FROM knowledge_items WHERE id = ?').bind(id).first();
      if (!existing) throw new NotFoundError('Item not found');

      const fields: string[] = [];
      const values: unknown[] = [];

      if (updates.filename !== undefined) { fields.push('filename = ?'); values.push(updates.filename); }
      if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
      if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
      if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
      if (updates.imageData !== undefined) {
        // Upload new image to R2 if bucket available, otherwise store base64
        let storedImageData: string | null = updates.imageData || null;
        if (updates.imageData && env.KB_BUCKET) {
          const filename = (updates.filename as string) || String(existing.filename || 'image');
          storedImageData = await uploadToR2(env.KB_BUCKET, id, filename, updates.imageData);
          // Delete old R2 object if replacing
          const oldKey = String(existing.image_data || '');
          if (isR2Key(oldKey) && env.KB_BUCKET) {
            await deleteFromR2(env.KB_BUCKET, oldKey).catch(() => {});
          }
        }
        fields.push('image_data = ?');
        values.push(storedImageData);
      }

      if (fields.length > 0) {
        values.push(id);
        await env.DB.prepare(
          `UPDATE knowledge_items SET ${fields.join(', ')} WHERE id = ?`
        ).bind(...values).run();
      }

      const updated = await env.DB.prepare('SELECT * FROM knowledge_items WHERE id = ?').bind(id).first();
      return successResponse(updated ? redactItem(updated as Record<string, unknown>) : null, requestId);
    }

    if (method === 'DELETE') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (!id) throw new ValidationError('id query parameter is required');

      const existing = await env.DB.prepare('SELECT * FROM knowledge_items WHERE id = ?').bind(id).first();
      if (!existing) throw new NotFoundError('Item not found');

      // Delete from R2 if the image was stored there
      const imageData = String(existing.image_data || '');
      if (isR2Key(imageData) && env.KB_BUCKET) {
        await deleteFromR2(env.KB_BUCKET, imageData).catch(() => {});
      }

      await env.DB.prepare('DELETE FROM knowledge_items WHERE id = ?').bind(id).run();
      return successResponse({ deleted: true }, requestId);
    }

    throw new ValidationError(`Method ${method} not allowed`);
  } catch (err) {
    return errorResponse(err, requestId);
  }
};

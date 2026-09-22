import { getUserSession } from '../user-auth';

interface Env {
  DB: D1Database;
  GENERATED_BUCKET?: R2Bucket;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!env.GENERATED_BUCKET) return Response.json({ error: 'Logo storage is unavailable' }, { status: 503 });

  const id = String((params as { id?: string }).id || '');
  const user = await getUserSession(request, env.DB);

  // If user is authenticated, query their own job; otherwise allow public viewing of completed jobs
  const job = user
    ? await env.DB.prepare(
        "SELECT brand_name,r2_key FROM generation_jobs WHERE id=? AND user_id=? AND status='completed'"
      ).bind(id, user.id).first<{ brand_name: string; r2_key: string | null }>()
    : await env.DB.prepare(
        "SELECT brand_name,r2_key FROM generation_jobs WHERE id=? AND status='completed'"
      ).bind(id).first<{ brand_name: string; r2_key: string | null }>();

  if (!job?.r2_key) return Response.json({ error: 'Logo not found' }, { status: 404 });

  const object = await env.GENERATED_BUCKET.get(job.r2_key);
  if (!object) return Response.json({ error: 'Stored logo not found' }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', `inline; filename="${job.brand_name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-logo.${job.r2_key.split('.').pop() || 'png'}"`);
  return new Response(object.body, { headers });
};

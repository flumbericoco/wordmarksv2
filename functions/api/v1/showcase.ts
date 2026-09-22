interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, brand_name, result_url, r2_key, quality_score, created_at
       FROM generation_jobs
       WHERE status = 'completed' AND result_url IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 24`
    ).all<{
      id: string;
      brand_name: string;
      result_url: string;
      r2_key: string | null;
      quality_score: number | null;
      created_at: string;
    }>();

    const generations = (rows.results || []).map((job) => ({
      id: job.id,
      brandName: job.brand_name,
      imageUrl: job.r2_key ? `/api/v1/logo/${job.id}` : job.result_url,
      qualityScore: job.quality_score,
      createdAt: job.created_at,
    }));

    return Response.json(
      { ok: true, generations },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60, s-maxage=120',
        },
      }
    );
  } catch (error) {
    return Response.json(
      { ok: false, generations: [], error: error instanceof Error ? error.message : 'Database error' },
      { status: 500 }
    );
  }
};

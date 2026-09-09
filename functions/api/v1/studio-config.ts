interface Env { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const rows = await env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('maxIterations','autoApprove')").all<{ key: string; value: string }>();
  const values = Object.fromEntries(rows.results.map((row) => [row.key, row.value]));
  return Response.json({
    ok: true,
    data: {
      maxIterations: Math.min(10, Math.max(1, Number(values.maxIterations) || 3)),
      autoReview: values.autoApprove === 'true',
    },
  });
};

import { getBYOKStatus } from '../../../lib/paypal';

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const status = await getBYOKStatus(env.DB);
    return Response.json({
      ok: true,
      ...status,
    }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to fetch BYOK status',
    }, { status: 500 });
  }
};

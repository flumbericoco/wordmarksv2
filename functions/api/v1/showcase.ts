interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const curatedLogos = [
    { id: 'apexlab', brandName: 'ApexLab', category: 'tech', tag: 'Biotech & AI Research', style: 'Precision Geometric Tech', imageUrl: '/showcase/apexlab-v2.png' },
    { id: 'sentrio', brandName: 'Sentrio', category: 'tech', tag: 'Intelligent Automation Cloud', style: 'Dynamic Streamline Sans', imageUrl: '/showcase/sentrio-v2.png' },
    { id: 'arclume', brandName: 'Arclume', category: 'design', tag: 'Architecture & Spatial Light', style: 'Architectural Apex Monogram', imageUrl: '/showcase/arclume-v2.png' },
    { id: 'gridora', brandName: 'Gridora', category: 'cloud', tag: 'Distributed Compute Mesh', style: 'Isometric Hexagon Emblem', imageUrl: '/showcase/gridora-v2.png' },
    { id: 'velisse', brandName: 'Velisse', category: 'luxury', tag: 'Haute Couture & Skincare', style: 'Botanical Leaf Serif', imageUrl: '/showcase/velisse-v2.png' },
    { id: 'nodera', brandName: 'Nodera', category: 'tech', tag: 'Data Systems & Knowledge Engine', style: 'Folded Prism Monogram', imageUrl: '/showcase/nodera-v2.png' },
    { id: 'arvena', brandName: 'ARVENA', category: 'tech', tag: 'Aerospace & Precision Systems', style: 'Minimal Apex Chevron', imageUrl: '/showcase/arvena-v2.png' },
    { id: 'pesat', brandName: 'Pesat.ai', category: 'cloud', tag: 'Enterprise AI & Agent Platform', style: 'Bold Tech Loop Emblem', imageUrl: '/showcase/pesat-v2.png' },
    { id: 'presto', brandName: 'Presto', category: 'cloud', tag: 'High-Velocity Logistics', style: 'Kinetic Vortex Pinwheel', imageUrl: '/showcase/presto-v2.png' },
  ];

  try {
    const brandNames = curatedLogos.map((c) => c.brandName);
    const placeholders = brandNames.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT id, brand_name, result_url, r2_key, quality_score, created_at
       FROM generation_jobs
       WHERE brand_name IN (${placeholders}) AND status = 'completed' AND result_url IS NOT NULL
       ORDER BY created_at DESC`
    ).bind(...brandNames).all<{
      id: string;
      brand_name: string;
      result_url: string;
      r2_key: string | null;
      quality_score: number | null;
      created_at: string;
    }>();

    const jobByBrand = new Map((rows.results || []).map((r) => [r.brand_name.toLowerCase(), r]));

    const enriched = curatedLogos.map((logo) => {
      const match = jobByBrand.get(logo.brandName.toLowerCase());
      if (match && match.result_url && !match.result_url.startsWith('data:')) {
        return {
          ...logo,
          imageUrl: match.r2_key ? `/api/v1/logo/${match.id}` : match.result_url,
          qualityScore: match.quality_score,
        };
      }
      return logo;
    });

    return Response.json(
      { ok: true, generations: enriched },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
      }
    );
  } catch {
    return Response.json(
      { ok: true, generations: curatedLogos },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
      }
    );
  }
};

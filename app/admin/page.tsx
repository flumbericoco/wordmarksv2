'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getStats, type AdminStats } from '@/lib/admin-api';

const quickLinks = [
  { href: '/admin/providers', number: '01', title: 'API Providers', copy: 'Manage models, endpoints, and provider access.', color: 'bg-[#c6ff4a]' },
  { href: '/admin/knowledge-base', number: '02', title: 'Visual Library', copy: 'Curate references that guide every generation.', color: 'bg-[#d9d3ff]' },
  { href: '/admin/settings', number: '03', title: 'Studio Settings', copy: 'Fine-tune quality, size, and iteration behavior.', color: 'bg-[#ffb7a6]' },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Failed to load stats'))
      .finally(() => setLoading(false));
  }, []);

  const generationTotal = stats?.generation.total ?? 0;
  const completionRate = generationTotal > 0
    ? Math.round(((stats?.generation.completed ?? 0) / generationTotal) * 100)
    : 0;

  return (
    <div className="admin-enter space-y-9">
      <section className="flex flex-col gap-6 border-b border-black/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#765ee8]">Workspace overview</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.055em] sm:text-6xl">Good to see you.</h1>
          <p className="mt-3 text-sm text-black/45">Everything powering your identity studio, at a glance.</p>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white/45 px-5 py-3">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-black/35">Environment</p>
          <p className="mt-1 flex items-center gap-2 text-xs font-bold"><span className="h-2 w-2 rounded-full bg-[#61c454]" /> Production</p>
        </div>
      </section>

      {error && <div role="alert" className="rounded-2xl border border-red-300 bg-red-50 px-5 py-4 text-sm text-red-700">{error}</div>}

      <section className="grid overflow-hidden rounded-[1.75rem] border border-black/10 bg-black/10 sm:grid-cols-3">
        <div className="bg-[#191916] p-6 text-white sm:p-8">
          <div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">API providers</p><span className="text-[#c6ff4a]">↗</span></div>
          <p className="mt-8 text-5xl font-black tracking-[-0.06em]">{loading ? '—' : stats?.providers.total ?? 0}</p>
          <p className="mt-2 truncate text-xs text-white/40">{stats?.providers.active ? `Active · ${stats.providers.active.name}` : 'No active provider'}</p>
        </div>
        <div className="bg-[#d9d3ff] p-6 sm:p-8">
          <div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-black/40">References</p><span>✦</span></div>
          <p className="mt-8 text-5xl font-black tracking-[-0.06em]">{loading ? '—' : stats?.knowledgeBase.total ?? 0}</p>
          <p className="mt-2 text-xs text-black/40">Items in the visual library</p>
        </div>
        <div className="bg-[#ff7655] p-6 sm:p-8">
          <div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-black/45">Generations</p><span>◎</span></div>
          <div className="mt-8 flex items-end justify-between gap-3">
            <p className="text-5xl font-black tracking-[-0.06em]">{loading ? '—' : generationTotal}</p>
            <span className="rounded-full bg-black/10 px-3 py-1 text-[10px] font-black">{completionRate}% success</span>
          </div>
          <p className="mt-2 text-xs text-black/45">{stats?.generation.completed ?? 0} completed · {stats?.generation.failed ?? 0} failed</p>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-black/10 bg-white/55 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-black/35">Service readiness</p><h2 className="mt-1 text-2xl font-black">Production dependencies</h2></div><span className="text-xs text-black/40">Configuration status, not synthetic uptime</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">{Object.entries(stats?.services || {}).map(([name, status]) => <div key={name} className="rounded-2xl border border-black/10 bg-white p-4"><p className="text-xs font-black uppercase">{name}</p><p className={`mt-2 text-sm font-bold ${status === 'missing' ? 'text-red-700' : 'text-green-700'}`}>{status}</p></div>)}</div>
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-black/35">Manage studio</p><h2 className="mt-1 text-2xl font-black tracking-[-0.04em]">Quick controls</h2></div>
          <span className="hidden text-xs text-black/35 sm:block">Choose an area to manage</span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {quickLinks.map((item) => (
            <Link key={item.href} href={item.href} className="group flex min-h-52 flex-col justify-between rounded-[1.6rem] border border-black/10 bg-white/55 p-6 transition-all hover:-translate-y-1 hover:bg-white hover:shadow-[0_20px_50px_rgba(30,25,20,0.08)]">
              <div className="flex items-center justify-between"><span className={`grid h-10 w-10 place-items-center rounded-full ${item.color} font-mono text-[10px] font-black`}>{item.number}</span><span className="text-xl transition-transform group-hover:rotate-45">↗</span></div>
              <div><h3 className="text-xl font-black tracking-[-0.035em]">{item.title}</h3><p className="mt-2 text-xs leading-5 text-black/45">{item.copy}</p></div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

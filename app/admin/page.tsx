'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getStats, runHealthChecks, type AdminHealth, type AdminStats } from '@/lib/admin-api';

const quickLinks = [
  { href: '/admin/providers', number: '01', title: 'API Providers', copy: 'Manage models, endpoints, and provider access.', color: 'bg-[#c6ff4a]' },
  { href: '/admin/creator', number: '02', title: 'Logo Creator', copy: 'Manage instructions and knowledge files in one place.', color: 'bg-[#d9d3ff]' },
  { href: '/admin/settings', number: '03', title: 'Studio Settings', copy: 'Control review and user-requested iteration behavior.', color: 'bg-[#ffb7a6]' },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [checking, setChecking] = useState(false);

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

  const checkServices = async () => {
    setChecking(true);
    setError(null);
    try { setHealth(await runHealthChecks()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Health check failed'); }
    finally { setChecking(false); }
  };

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
          <p className="mt-1 flex items-center gap-2 text-xs font-bold"><span className={`h-2 w-2 rounded-full ${stats?.environment === 'Live' ? 'bg-[#61c454]' : 'bg-amber-500'}`} /> {loading ? 'Checking...' : stats?.environment || 'Unconfigured'}</p>
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
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-black/35">Service readiness</p><h2 className="mt-1 text-2xl font-black">Production dependencies</h2></div><button onClick={checkServices} disabled={checking} className="rounded-full bg-[#191916] px-4 py-2 text-xs font-black text-white disabled:opacity-50">{checking ? 'Checking...' : 'Run live checks'}</button></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">{Object.entries(health?.checks || stats?.services || {}).map(([name, value]) => {
          const status = typeof value === 'string' ? value : value.status;
          const latency = typeof value === 'string' ? undefined : value.latencyMs;
          const detail = typeof value === 'string' ? undefined : value.detail;
          return <div key={name} className="rounded-2xl border border-black/10 bg-white p-4"><p className="text-xs font-black uppercase">{name}</p><p className={`mt-2 text-sm font-bold ${status === 'up' || status === 'configured' ? 'text-green-700' : status === 'missing' ? 'text-amber-700' : 'text-red-700'}`}>{status}{latency !== undefined ? ` · ${latency}ms` : ''}</p>{detail ? <p className="mt-1 text-[10px] text-black/45">{detail}</p> : null}</div>;
        })}</div>
        <p className="mt-3 text-[10px] text-black/35">{health ? `Live checks completed ${new Date(health.checkedAt).toLocaleString()}` : 'Initial values show configuration only. Run live checks before release.'}</p>
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

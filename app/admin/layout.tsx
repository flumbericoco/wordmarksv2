'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/admin', label: 'Overview', short: 'OV', description: 'Workspace pulse' },
  { href: '/admin/providers', label: 'Providers', short: 'AP', description: 'Models & API keys' },
  { href: '/admin/knowledge-base', label: 'Library', short: 'KB', description: 'Visual references' },
  { href: '/admin/settings', label: 'Settings', short: 'ST', description: 'Generation defaults' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="admin-shell min-h-screen bg-[#eeece5] text-[#191916]">
      <header className="sticky top-0 z-50 border-b border-black/10 bg-[#eeece5]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="Back to Wordmarks">
            <span className="text-xl font-black tracking-[-0.06em]">wordmarks<span className="text-[#ff5c35]">.</span></span>
            <span className="rounded-full border border-black/15 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em]">Studio admin</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-black/45 sm:flex"><span className="h-2 w-2 animate-pulse rounded-full bg-[#61c454]" /> System online</span>
            <Link href="/" className="rounded-full bg-[#191916] px-4 py-2.5 text-xs font-bold text-white transition-transform hover:-translate-y-0.5">View website ↗</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b border-black/10 px-4 py-4 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:border-b-0 lg:border-r lg:px-5 lg:py-7">
          <p className="mb-3 hidden px-3 text-[9px] font-black uppercase tracking-[0.2em] text-black/30 lg:block">Control center</p>
          <nav className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Admin navigation">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link key={item.href} href={item.href} className={`group flex min-w-max items-center gap-3 rounded-2xl p-2.5 transition-all lg:min-w-0 ${isActive ? 'bg-[#191916] text-white shadow-lg' : 'text-black/55 hover:bg-black/[0.05] hover:text-black'}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl font-mono text-[10px] font-bold ${isActive ? 'bg-[#c6ff4a] text-black' : 'border border-black/10 bg-white/50'}`}>{item.short}</span>
                  <span className="pr-3 text-left"><span className="block text-sm font-bold">{item.label}</span><span className={`hidden text-[10px] lg:block ${isActive ? 'text-white/40' : 'text-black/35'}`}>{item.description}</span></span>
                </Link>
              );
            })}
          </nav>
          <div className="absolute bottom-7 left-5 right-5 hidden rounded-2xl bg-[#d9d3ff] p-4 lg:block">
            <p className="text-xs font-black">Need a fresh mark?</p>
            <p className="mt-1 text-[10px] leading-4 text-black/50">Jump back to the creative studio.</p>
            <Link href="/#create" className="mt-4 inline-flex text-[10px] font-black uppercase tracking-wider">Create wordmark →</Link>
          </div>
        </aside>
        <main className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">{children}</main>
      </div>
    </div>
  );
}

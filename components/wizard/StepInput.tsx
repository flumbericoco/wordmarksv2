'use client';

import { useEffect, useRef, useState } from 'react';
import StepNavigation from './StepNavigation';

interface StepInputProps {
  brandName: string;
  description: string;
  onNext: (name: string, desc: string) => void;
}

export default function StepInput({ brandName, description, onNext }: StepInputProps) {
  const [name, setName] = useState(brandName);
  const [desc, setDesc] = useState(description);
  const draftLoaded = useRef(false);
  const cleanName = name.trim();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem('wordmarks:draft') || '{}') as { name?: string; description?: string; savedAt?: number };
        if (!saved.savedAt || Date.now() - saved.savedAt > 24 * 60 * 60_000) return localStorage.removeItem('wordmarks:draft');
        if (!brandName && saved.name) setName(saved.name);
        if (!description && saved.description) setDesc(saved.description);
      } catch { /* Ignore malformed browser storage. */ }
      draftLoaded.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [brandName, description]);

  useEffect(() => {
    if (!draftLoaded.current) return;
    localStorage.setItem('wordmarks:draft', JSON.stringify({ name, description: desc, savedAt: Date.now() }));
  }, [name, desc]);

  return (
    <div className="wizard-enter">
      <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:gap-12">
        <div className="flex flex-col justify-between rounded-[1.6rem] border border-white/10 bg-gradient-to-br from-white/[0.08] to-transparent p-6 sm:p-8">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#c6ff4a] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.17em] text-black">
              <span className="h-1.5 w-1.5 rounded-full bg-black" />
              Brand brief
            </span>
            <h2 className="mt-6 text-4xl font-black leading-[0.95] tracking-[-0.055em] text-white sm:text-5xl">
              Start with<br /><span className="font-serif font-normal italic text-[#ff7655]">your story.</span>
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-6 text-white/45">
              Two simple details are enough for AI to research your space and build a unique creative direction.
            </p>
          </div>

          <div className="mt-10 border-t border-white/10 pt-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">Live wordmark preview</p>
            <p className={`mt-3 min-h-12 break-words text-4xl font-black tracking-[-0.06em] transition-all duration-300 ${cleanName ? 'text-white' : 'text-white/15'}`}>
              {cleanName || 'Your name'}<span className="text-[#ff7655]">.</span>
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <div className="space-y-5">
            <div className="group">
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="brand-name" className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">Brand name</label>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#c6ff4a]">Required</span>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 font-serif text-xl italic text-white/25" aria-hidden="true">Aa</span>
                <input
                  id="brand-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Aster, North, Luma"
                  autoComplete="organization"
                  className="h-16 w-full rounded-2xl border border-white/10 bg-white/[0.055] pl-14 pr-5 text-lg font-semibold text-white placeholder:text-white/20 transition-all duration-300 hover:border-white/20 focus:border-[#c6ff4a]/70 focus:bg-white/[0.08] focus:shadow-[0_0_0_4px_rgba(198,255,74,0.08)]"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && cleanName) onNext(cleanName, desc.trim());
                  }}
                />
              </div>
            </div>

            <div className="group">
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="brand-description" className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">What does it do?</label>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-white/25">Optional</span>
              </div>
              <textarea
                id="brand-description"
                value={desc}
                onChange={(event) => setDesc(event.target.value)}
                placeholder="A short description of your product, audience, and personality..."
                rows={4}
                maxLength={320}
                className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.055] px-5 py-4 text-sm leading-6 text-white placeholder:text-white/20 transition-all duration-300 hover:border-white/20 focus:border-[#c6ff4a]/70 focus:bg-white/[0.08] focus:shadow-[0_0_0_4px_rgba(198,255,74,0.08)]"
              />
              <p className="mt-2 text-right font-mono text-[10px] text-white/20">{desc.length}/320</p>
            </div>
          </div>

          <StepNavigation
            onBack={() => {}}
            onNext={() => onNext(cleanName, desc.trim())}
            nextLabel="Find my direction"
            nextDisabled={!cleanName}
            canGoBack={false}
          />
          {(name || desc) ? <button type="button" onClick={() => { setName(''); setDesc(''); localStorage.removeItem('wordmarks:draft'); }} className="mt-3 self-end text-xs text-white/40 underline underline-offset-4 hover:text-white">Clear saved draft</button> : null}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { WizardData, LogoResult, QualityScore } from '@/lib/types';
import { generateLogo, reviewLogo, iterateLogo } from '@/lib/api';
import WizardContainer from '@/components/wizard/WizardContainer';
import LogoResultView from '@/components/LogoResultView';

const showcaseWords = [
  { name: 'Aster', className: 'font-serif italic' },
  { name: 'NORTH', className: 'font-black tracking-[-0.08em]' },
  { name: 'luma', className: 'font-light tracking-[0.16em]' },
  { name: 'Kanso', className: 'font-semibold italic' },
  { name: 'VANTA', className: 'font-black tracking-[0.04em]' },
  { name: 'orbit', className: 'font-mono font-medium' },
];

const steps = [
  ['01', 'Describe your brand', 'Share a name and a few words about what makes it different.'],
  ['02', 'AI finds your direction', 'We research your space and shape a fitting visual language.'],
  ['03', 'Refine until it clicks', 'Review, iterate, and download a mark that feels unmistakably yours.'],
];

const pricingPlans = [
  { name: 'Lite', monthly: '$1', monthlyCredits: '1', effective: '$1.00', featured: false },
  { name: 'Growth', monthly: '$3', monthlyCredits: '4', effective: '$0.75', featured: true },
  { name: 'Pro', monthly: '$7', monthlyCredits: '10', effective: '$0.70', featured: false },
  { name: 'Scale', monthly: '$17', monthlyCredits: '28', effective: '$0.61', featured: false },
];

export default function Home() {
  const [view, setView] = useState<'wizard' | 'result'>('wizard');
  const [wizardData, setWizardData] = useState<WizardData | null>(null);
  const [research, setResearch] = useState('');
  const [logo, setLogo] = useState<LogoResult | null>(null);
  const [qualityReview, setQualityReview] = useState<QualityScore | null>(null);
  const [iteration, setIteration] = useState(0);
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<{ email: string; credits: number } | null>(null);
  const [maxIterations, setMaxIterations] = useState(3);
  const [autoReview, setAutoReview] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch('/api/v1/account/me', { credentials: 'same-origin' })
        .then(async (response) => response.ok ? response.json() as Promise<{ user?: { email: string; credits: number } }> : null)
        .then((payload) => setAccount(payload?.user || null))
        .catch(() => setAccount(null));
      void fetch('/api/v1/studio-config')
        .then((response) => response.json() as Promise<{ data?: { maxIterations?: number; autoReview?: boolean } }>)
        .then((payload) => { setMaxIterations(payload?.data?.maxIterations || 3); setAutoReview(Boolean(payload?.data?.autoReview)); })
        .catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const rememberResult = (
    data: WizardData,
    researchText: string,
    result: LogoResult,
    nextIteration: number
  ) => {
    try {
      sessionStorage.setItem('wordmarks:last-result', JSON.stringify({
        data,
        research: researchText,
        logo: result,
        iteration: nextIteration,
      }));
    } catch {
      // A large data URL can exceed browser storage. The generated logo still works in this tab.
    }
  };

  const refreshCredits = () => {
    void fetch('/api/v1/account/me', { credentials: 'same-origin' })
      .then(async (response) => response.ok ? response.json() as Promise<{ user?: { email: string; credits: number } }> : null)
      .then((payload) => setAccount(payload?.user || null))
      .catch(() => undefined);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = sessionStorage.getItem('wordmarks:last-result');
        if (!saved) return;
        const parsed = JSON.parse(saved) as {
          data?: WizardData;
          research?: string;
          logo?: LogoResult;
          iteration?: number;
        };
        if (!parsed.data || !parsed.logo?.imageUrl) return;
        setWizardData(parsed.data);
        setResearch(parsed.research || '');
        setLogo(parsed.logo);
        setCurrentPrompt(parsed.logo.revisedPrompt || '');
        setIteration(parsed.iteration || 0);
        setView('result');
      } catch {
        sessionStorage.removeItem('wordmarks:last-result');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>('[data-reveal]');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px' }
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [view]);

  const handleWizardComplete = async (data: WizardData, researchText: string) => {
    setWizardData(data);
    setResearch(researchText);
    setView('result');
    setIsGenerating(true);
    setError(null);
    try {
      const result = await generateLogo(data, researchText);
      setLogo(result);
      setCurrentPrompt(result.revisedPrompt);
      rememberResult(data, researchText, result, 0);
      if (autoReview) {
        const review = await reviewLogo(result.revisedPrompt, data.brandName).catch(() => null);
        if (review) setQualityReview(review);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
      refreshCredits();
    }
  };

  const handleRegenerate = async () => {
    if (!wizardData) return;
    if (!window.confirm('Regenerating uses 1 credit. Continue?')) return;
    setIsGenerating(true);
    setError(null);
    try {
      const result = await generateLogo(wizardData, research);
      setLogo(result);
      setCurrentPrompt(result.revisedPrompt);
      setQualityReview(null);
      rememberResult(wizardData, research, result, iteration);
      if (autoReview) {
        const review = await reviewLogo(result.revisedPrompt, wizardData.brandName).catch(() => null);
        if (review) setQualityReview(review);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Regeneration failed');
    } finally {
      setIsGenerating(false);
      refreshCredits();
    }
  };

  const handleReview = async () => {
    if (!logo || !wizardData) return;
    setIsReviewing(true);
    setError(null);
    try {
      const review = await reviewLogo(logo.revisedPrompt, wizardData.brandName);
      setQualityReview(review);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setIsReviewing(false);
    }
  };

  const handleIterate = async () => {
    if (!qualityReview || !logo || !wizardData) return;
    if (iteration >= maxIterations) return setError(`Maximum of ${maxIterations} revisions reached for this logo.`);
    if (!window.confirm('Creating this revision uses 1 credit. Continue?')) return;
    setIsGenerating(true);
    setError(null);
    try {
      const refinedPrompt = await iterateLogo(
        currentPrompt,
        qualityReview.feedback,
        qualityReview.suggestions,
        wizardData
      );
      const result = await generateLogo({ ...wizardData, description: refinedPrompt }, research);
      setLogo(result);
      setCurrentPrompt(result.revisedPrompt);
      setQualityReview(null);
      const nextIteration = iteration + 1;
      setIteration(nextIteration);
      rememberResult(wizardData, research, result, nextIteration);
      if (autoReview) {
        const review = await reviewLogo(result.revisedPrompt, wizardData.brandName).catch(() => null);
        if (review) setQualityReview(review);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Iteration failed');
    } finally {
      setIsGenerating(false);
      refreshCredits();
    }
  };

  const handleDownload = async () => {
    if (!logo?.imageUrl || !wizardData) return;
    try {
      const response = await fetch(logo.imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const extension = logo.imageUrl.startsWith('data:image/svg+xml') ? 'svg' : 'png';
      anchor.download = `${wizardData.brandName.toLowerCase().replace(/\s+/g, '-')}-logo.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(logo.imageUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleNewLogo = () => {
    sessionStorage.removeItem('wordmarks:last-result');
    localStorage.removeItem('wordmarks:draft');
    setView('wizard');
    setLogo(null);
    setQualityReview(null);
    setIteration(0);
    setCurrentPrompt('');
    setError(null);
    requestAnimationFrame(() => document.querySelector('#create')?.scrollIntoView({ behavior: 'smooth' }));
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#f2f0e9] text-[#171714]">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-black/10 bg-[#f2f0e9]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="group flex items-baseline" aria-label="Wordmarks home">
            <span className="text-[1.35rem] font-black tracking-[-0.06em]">wordmarks</span>
            <span className="ml-1 h-1.5 w-1.5 rounded-full bg-[#ff5c35] transition-transform group-hover:scale-150" />
          </a>
          <nav className="flex items-center gap-3 sm:gap-7" aria-label="Main navigation">
            <a href="#process" className="hidden text-xs font-semibold uppercase tracking-[0.16em] transition-opacity hover:opacity-50 sm:block">Process</a>
            <a href="/developers" className="hidden text-xs font-semibold uppercase tracking-[0.16em] transition-opacity hover:opacity-50 md:block">Developers</a>
            <a href="#pricing" className="hidden text-xs font-semibold uppercase tracking-[0.16em] transition-opacity hover:opacity-50 lg:block">Pricing</a>
            <a href="/admin" className="hidden text-xs font-semibold uppercase tracking-[0.16em] transition-opacity hover:opacity-50 sm:block">Admin</a>
            <a href="/account" className="hidden rounded-full border border-black/15 px-4 py-2 text-xs font-bold sm:block">{account ? `${account.credits} credits` : 'Sign in'}</a>
            <a href="#create" className="rounded-full bg-[#171714] px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-white transition-transform hover:-translate-y-0.5">Create yours</a>
          </nav>
        </div>
      </header>

      <main id="top">
        {view === 'wizard' && (
          <>
            <section data-reveal className="reveal-section relative mx-auto grid max-w-7xl items-center gap-6 px-5 pb-9 pt-24 sm:px-8 lg:min-h-[570px] lg:grid-cols-[1.08fr_0.92fr] lg:py-16">
              <div className="relative z-10">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-black/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.19em]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff5c35]" />
                  AI-powered identity studio
                </div>
                <h1 className="max-w-3xl text-[clamp(3.55rem,8vw,6.8rem)] font-black leading-[0.8] tracking-[-0.085em]">
                  Make your
                  <span className="relative mt-4 block font-serif font-normal italic tracking-[-0.06em] text-[#d94324]">name iconic.</span>
                </h1>
                <p className="mt-6 max-w-xl text-base leading-7 text-black/60 sm:text-lg">
                  Distinctive, typography-first logos shaped by strategy and refined by AI—ready in minutes, not weeks.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-5">
                  <a href="#create" className="group inline-flex items-center gap-8 rounded-full bg-[#171714] py-4 pl-6 pr-4 text-sm font-bold text-white transition-transform hover:-translate-y-1">
                    Start creating
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-[#ff5c35] transition-transform group-hover:rotate-45" aria-hidden="true">↗</span>
                  </a>
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-black/65">No design skills needed</span>
                </div>
                <p className="mt-4 text-xs text-black/65">Create an account and receive 10 beta credits. One successful logo generation uses one credit.</p>
              </div>

              <div className="relative mx-auto aspect-square w-full max-w-[380px] lg:justify-self-end">
                <div className="hero-orbit absolute inset-[10%] rounded-full border border-black/15" />
                <div className="hero-orbit-reverse absolute inset-[22%] rounded-full border border-dashed border-black/20" />
                <div className="absolute left-[7%] top-[13%] -rotate-6 rounded-2xl bg-[#171714] px-7 py-5 text-3xl font-black tracking-[-0.07em] text-white shadow-2xl">NORTH</div>
                <div className="float-slow absolute right-[2%] top-[28%] rotate-6 rounded-full bg-[#c6ff4a] px-7 py-5 text-3xl font-serif italic shadow-xl">Kanso</div>
                <div className="float-fast absolute bottom-[19%] left-[3%] -rotate-3 rounded-2xl border border-black/15 bg-white px-7 py-5 text-4xl font-light tracking-[0.13em] shadow-xl">luma</div>
                <div className="absolute bottom-[7%] right-[4%] rotate-3 rounded-2xl bg-[#ff5c35] px-7 py-5 text-3xl font-mono font-bold text-white shadow-xl">orbit</div>
                <div className="absolute left-1/2 top-1/2 grid h-36 w-36 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[18px] border-[#f2f0e9] bg-[#6c5ce7] text-center text-xs font-black uppercase tracking-[0.16em] text-white shadow-2xl">
                  Your brand<br />starts here
                </div>
                <span className="absolute right-[17%] top-[8%] text-5xl text-[#ff5c35]" aria-hidden="true">✦</span>
                <span className="absolute bottom-[6%] left-[38%] text-4xl" aria-hidden="true">✳</span>
              </div>
            </section>

            <section data-reveal className="reveal-section border-y border-black/10 bg-[#171714] py-4 text-white" aria-label="Example wordmarks">
              <div className="marquee-track flex w-max items-center gap-12 whitespace-nowrap pr-12">
                {[...showcaseWords, ...showcaseWords].map((word, index) => (
                  <span key={`${word.name}-${index}`} className={`text-3xl ${word.className}`}>{word.name}</span>
                ))}
              </div>
            </section>

            <section id="process" data-reveal className="reveal-section mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:py-14">
              <div className="grid gap-7 lg:grid-cols-[0.55fr_1.45fr] lg:items-center">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ff5c35]">The process</p>
                  <h2 className="mt-3 max-w-md text-4xl font-black leading-[0.92] tracking-[-0.06em]">Three moves. One iconic mark.</h2>
                </div>
                <div className="divide-y divide-black/15 border-y border-black/15">
                  {steps.map(([number, title, description]) => (
                    <div key={number} className="group grid gap-2 py-4 sm:grid-cols-[48px_0.9fr_1.1fr] sm:items-center">
                      <span className="font-mono text-xs text-black/35">{number}</span>
                      <h3 className="text-xl font-bold tracking-[-0.03em] transition-transform group-hover:translate-x-2">{title}</h3>
                      <p className="text-sm leading-6 text-black/50">{description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section data-reveal className="reveal-section bg-[#171714] px-5 py-20 text-white sm:px-8 lg:py-28">
              <div className="mx-auto max-w-7xl">
                <div className="flex flex-col gap-5 border-b border-white/15 pb-10 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#c6ff4a]">Designed with intent</p>
                    <h2 className="mt-4 max-w-3xl text-5xl font-black leading-[0.9] tracking-[-0.065em] sm:text-7xl">More than a logo.<br />A first impression.</h2>
                  </div>
                  <p className="max-w-sm text-sm leading-6 text-white/45">Every recommendation is grounded in your brand, audience, and category—not pulled from a generic template.</p>
                </div>

                <div className="grid gap-px overflow-hidden rounded-[2rem] bg-white/15 mt-10 md:grid-cols-3">
                  <article data-reveal className="reveal-section reveal-delay-1 group min-h-72 bg-[#171714] p-7 transition-colors hover:bg-[#232320]">
                    <span className="text-5xl font-serif italic text-[#ff5c35]">Aa</span>
                    <h3 className="mt-20 text-2xl font-bold tracking-[-0.04em]">Type with character</h3>
                    <p className="mt-3 text-sm leading-6 text-white/45">Typography selected to match the attitude, rhythm, and ambition of your brand.</p>
                  </article>
                  <article data-reveal className="reveal-section reveal-delay-2 group min-h-72 bg-[#171714] p-7 transition-colors hover:bg-[#232320]">
                    <div className="flex gap-2" aria-hidden="true">
                      <span className="h-10 w-10 rounded-full bg-[#6c5ce7]" />
                      <span className="h-10 w-10 rounded-full bg-[#c6ff4a]" />
                      <span className="h-10 w-10 rounded-full bg-[#ff5c35]" />
                    </div>
                    <h3 className="mt-20 text-2xl font-bold tracking-[-0.04em]">Color that speaks</h3>
                    <p className="mt-3 text-sm leading-6 text-white/45">Strategic palettes that express your personality before a single word is read.</p>
                  </article>
                  <article data-reveal className="reveal-section reveal-delay-3 group min-h-72 bg-[#171714] p-7 transition-colors hover:bg-[#232320]">
                    <div className="grid h-10 w-16 place-items-center border-2 border-white text-[9px] font-black tracking-widest" aria-hidden="true">LOGO</div>
                    <h3 className="mt-20 text-2xl font-bold tracking-[-0.04em]">Built to adapt</h3>
                    <p className="mt-3 text-sm leading-6 text-white/45">A clean mark that stays confident across websites, products, and social profiles.</p>
                  </article>
                </div>
              </div>
            </section>

            <section id="developers" data-reveal className="reveal-section overflow-hidden bg-[#c6ff4a] px-5 py-16 sm:px-8 lg:py-24">
              <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-black/20 bg-white/35 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#171714]" />
                    MCP + REST API
                  </div>
                  <h2 className="mt-5 max-w-xl text-5xl font-black leading-[0.88] tracking-[-0.07em] sm:text-7xl">
                    Logos from your AI agent.
                  </h2>
                  <p className="mt-6 max-w-xl text-base leading-7 text-black/60">
                    Connect Wordmarks once, then create production-ready SVG logos from Codex, Kilo, Zcode, Claude Code, or any MCP-compatible CLI using natural language.
                  </p>
                  <div className="mt-7 flex flex-wrap gap-2" role="list" aria-label="Compatible AI agents">
                    {['Codex', 'Kilo', 'Zcode', 'Claude Code', 'Any MCP client'].map((agent) => (
                      <span role="listitem" key={agent} className="rounded-full border border-black/15 bg-white/45 px-3 py-1.5 text-xs font-bold">{agent}</span>
                    ))}
                  </div>
                </div>

                <div className="rounded-[2rem] bg-[#171714] p-5 text-white shadow-[0_24px_70px_rgba(30,40,10,0.2)] sm:p-8">
                  <div className="flex items-center justify-between border-b border-white/10 pb-5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5c35]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#f2cf5b]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#c6ff4a]" />
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">Agent-ready</span>
                  </div>
                  <div className="py-6 font-mono text-xs leading-7 sm:text-sm">
                    <p className="text-white/35"># Remote MCP endpoint</p>
                    <p className="break-all text-[#c6ff4a]">https://wordmarks-v2-dz1.pages.dev/mcp</p>
                    <p className="mt-4 text-white/35"># Available tool</p>
                    <p className="text-white">generate_wordmark_logo</p>
                    <p className="mt-4 text-white/35"># Then just ask your agent</p>
                    <p className="text-white">&quot;Create a bold blue wordmark for Orbit Labs and save it as SVG.&quot;</p>
                  </div>
                  <div className="grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-3">
                    {[
                      ['01', 'Add endpoint'],
                      ['02', 'Authenticate'],
                      ['03', 'Describe your logo'],
                    ].map(([number, label]) => (
                      <div key={number} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                        <p className="font-mono text-[10px] text-[#c6ff4a]">{number}</p>
                        <p className="mt-1 text-xs font-bold">{label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-5 text-xs leading-5 text-white/40">Bearer token required. Credentials stay server-side; PesatRouter keys are never exposed to agents.</p>
                  <a href="/developers" className="mt-5 inline-flex text-xs font-black uppercase tracking-[0.13em] text-[#c6ff4a] transition-opacity hover:opacity-65">Read developer docs →</a>
                </div>
              </div>
            </section>

            <section data-reveal className="reveal-section relative overflow-hidden bg-[#ff5c35] px-5 py-20 sm:px-8 lg:py-28">
              <span className="pointer-events-none absolute -right-10 -top-24 font-serif text-[20rem] italic leading-none text-black/5" aria-hidden="true">“</span>
              <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.45fr_1fr] lg:items-end">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em]">Made for momentum</p>
                  <div className="mt-6 flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-full bg-[#171714] text-sm font-bold text-white">W</div>
                    <div>
                      <p className="text-sm font-bold">From idea to identity</p>
                      <p className="text-xs text-black/55">In one creative flow</p>
                    </div>
                  </div>
                </div>
                <blockquote className="max-w-4xl text-4xl font-black leading-[1.02] tracking-[-0.055em] sm:text-6xl">
                  Your next big idea deserves a name people remember—and a mark they recognize anywhere.
                </blockquote>
              </div>
            </section>

            <section id="pricing" data-reveal className="reveal-section bg-[#f2f0e9] px-5 py-16 sm:px-8 lg:py-24">
              <div className="mx-auto max-w-7xl">
                <div className="grid gap-6 border-b border-black/15 pb-10 lg:grid-cols-[1fr_0.8fr] lg:items-end">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#5b42d5]">Simple pricing</p>
                    <h2 className="mt-4 max-w-3xl text-5xl font-black leading-[0.9] tracking-[-0.065em] sm:text-7xl">
                      Start with 25 logos for $25.
                    </h2>
                  </div>
                  <p className="max-w-xl text-base leading-7 text-black/55 lg:justify-self-end">
                    Top up anytime. Credits never expire. Keep your account active from only $1 a month and receive fresh credits every month.
                  </p>
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {pricingPlans.map((plan) => (
                    <article
                      key={plan.name}
                      className={`relative flex min-h-80 flex-col rounded-[1.75rem] border p-6 transition-transform hover:-translate-y-1 ${
                        plan.featured
                          ? 'border-[#171714] bg-[#171714] text-white shadow-[0_20px_50px_rgba(23,23,20,0.18)]'
                          : 'border-black/15 bg-white/55 text-[#171714]'
                      }`}
                    >
                      {plan.featured ? (
                        <span className="absolute right-5 top-5 rounded-full bg-[#c6ff4a] px-3 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-black">Most popular</span>
                      ) : null}
                      <p className={`text-xs font-black uppercase tracking-[0.18em] ${plan.featured ? 'text-white/45' : 'text-black/40'}`}>{plan.name}</p>
                      <div className="mt-7 flex items-end gap-2">
                        <span className="text-5xl font-black tracking-[-0.07em]">{plan.monthly}</span>
                        <span className={`pb-1 text-xs ${plan.featured ? 'text-white/45' : 'text-black/45'}`}>/month</span>
                      </div>
                      <p className={`mt-3 text-sm ${plan.featured ? 'text-white/55' : 'text-black/55'}`}>$25 today includes 25 logo credits.</p>
                      <div className={`my-6 h-px ${plan.featured ? 'bg-white/15' : 'bg-black/10'}`} />
                      <ul className={`space-y-3 text-sm ${plan.featured ? 'text-white/70' : 'text-black/65'}`}>
                        <li>{plan.monthlyCredits} new {plan.monthlyCredits === '1' ? 'credit' : 'credits'} every month</li>
                        <li>From {plan.effective} per logo</li>
                        <li>Credits never expire</li>
                        <li>Top up and cancel anytime</li>
                      </ul>
                      <a
                        href={`/account?plan=${plan.name.toLowerCase()}`}
                        className={`mt-auto rounded-full px-5 py-3 text-center text-xs font-black uppercase tracking-[0.13em] transition-transform hover:-translate-y-0.5 ${
                          plan.featured ? 'bg-[#c6ff4a] text-black' : 'bg-[#171714] text-white'
                        }`}
                      >
                        Choose {plan.name}
                      </a>
                    </article>
                  ))}
                </div>

                <div className="mt-7 grid gap-3 rounded-2xl border border-black/10 bg-white/40 p-5 text-sm text-black/60 sm:grid-cols-3">
                  <p><strong className="text-black">One credit, one logo.</strong><br />No confusing token math.</p>
                  <p><strong className="text-black">Use them anytime.</strong><br />Unused credits roll over forever.</p>
                  <p><strong className="text-black">No lock-in.</strong><br />Change plans or cancel whenever you want.</p>
                </div>
              </div>
            </section>
          </>
        )}

        <section id="create" data-reveal className={`reveal-section relative border-t border-black/10 bg-[#d9d3ff] px-5 sm:px-8 ${view === 'wizard' ? 'py-12 lg:py-14' : 'min-h-screen pb-16 pt-24'}`}>
          <div className="pointer-events-none absolute -right-16 top-0 text-[15rem] font-black leading-none text-white/20" aria-hidden="true">W</div>
          <div className="relative mx-auto max-w-5xl">
            {view === 'wizard' && (
              <div className="mb-6 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#5b42d5]">Your turn</p>
                <h2 className="mt-2 text-4xl font-black tracking-[-0.06em] sm:text-5xl">What should we call it?</h2>
                <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-black/55">Give us the story. We&apos;ll shape the visual identity.</p>
              </div>
            )}

            {error && (
              <div role="alert" className="mb-6 flex items-center justify-between rounded-2xl border border-red-950/15 bg-red-100 px-5 py-4 text-sm text-red-900 shadow-sm">
                <span><strong>Something went wrong:</strong> {error}</span>
                <button type="button" onClick={() => setError(null)} className="ml-4 rounded-full px-2 py-1 font-bold hover:bg-red-200" aria-label="Dismiss error">×</button>
              </div>
            )}

            <div className="rounded-[2rem] border border-black/10 bg-[#10100f] p-5 text-white shadow-[0_24px_70px_rgba(30,20,70,0.18)] sm:p-8">
              {view === 'wizard' ? (
                <WizardContainer onComplete={handleWizardComplete} />
              ) : logo ? (
                <LogoResultView
                  imageUrl={logo.imageUrl}
                  revisedPrompt={logo.revisedPrompt}
                  qualityReview={qualityReview}
                  brandName={wizardData?.brandName || ''}
                  iteration={iteration}
                  isReviewing={isReviewing}
                  isGenerating={isGenerating}
                  onRegenerate={handleRegenerate}
                  onReview={handleReview}
                  onIterate={handleIterate}
                  onDownload={handleDownload}
                  onNewLogo={handleNewLogo}
                />
              ) : isGenerating ? (
                <div className="flex flex-col items-center gap-5 py-24 text-center">
                  <div className="relative grid h-16 w-16 place-items-center rounded-full border border-white/15">
                    <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[#c6ff4a]" />
                    <span className="text-2xl" aria-hidden="true">✦</span>
                  </div>
                  <div>
                    <p className="text-lg font-bold">Crafting your wordmark...</p>
                    <p className="mt-1 text-sm text-white/40">Preparing prompt → generating → validating SVG → saving</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 py-20 text-center">
                  <h3 className="text-2xl font-black">Your credit is safe.</h3>
                  <p className="max-w-md text-sm leading-6 text-white/45">The provider could not finish this logo. Failed generations are refunded automatically.</p>
                  <div className="flex flex-wrap justify-center gap-3"><button onClick={handleRegenerate} className="rounded-full bg-[#c6ff4a] px-5 py-3 text-xs font-black uppercase text-black">Retry generation</button><button onClick={handleNewLogo} className="rounded-full border border-white/15 px-5 py-3 text-xs font-black uppercase text-white">Edit brief</button></div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer data-reveal className="reveal-section bg-[#171714] px-5 py-7 text-white sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-3xl font-black tracking-[-0.06em]">wordmarks<span className="text-[#ff5c35]">.</span></p>
            <p className="mt-2 text-xs text-white/35">Names deserve better logos.</p>
          </div>
          <div className="flex flex-wrap gap-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/refund-policy">Refunds</a><a href="/support">Support</a><span>AI-powered typography studio · 2026</span></div>
        </div>
      </footer>
    </div>
  );
}

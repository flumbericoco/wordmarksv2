'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';

interface User { id: string; email: string; plan: string; credits: number }
interface ApiKey { id: string; name: string; key_prefix: string; created_at: string; last_used_at?: string; revoked_at?: string }
interface Subscription { id: string; plan: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean }
interface Invoice { id: string; number: string; status: string; amountPaid: number; currency: string; createdAt: string; hostedUrl: string | null }
interface CreditEntry { id: string; amount: number; reason: string; created_at: string }
interface BillingData { subscription: Subscription | null; invoices: Invoice[]; creditHistory: CreditEntry[] }
interface Generation { id:string; brand_name:string; status:string; model:string; result_url?:string; error?:string; created_at:string }

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiRequestError(payload.error || 'Request failed', response.status);
  return payload;
}

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newToken, setNewToken] = useState('');
  const [billing, setBilling] = useState<BillingData>({ subscription: null, invoices: [], creditHistory: [] });
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [requestedPlan] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('plan') || '');
  const [message, setMessage] = useState(() => {
    if (typeof window === 'undefined') return '';
    const checkoutState = new URLSearchParams(window.location.search).get('checkout');
    if (checkoutState === 'success') return 'Payment received. Credits may take a few seconds to appear.';
    if (checkoutState === 'cancelled') return 'Checkout cancelled. You were not charged.';
    return '';
  });
  const [busy, setBusy] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showRevokedKeys, setShowRevokedKeys] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await api<{ user: User }>('account/me');
      setUser(me.user);
      try {
        const keyData = await api<{ keys: ApiKey[] }>('account/keys');
        setKeys(keyData.keys);
      } catch (reason) {
        if (reason instanceof ApiRequestError && reason.status === 401) setUser(null);
      }
      try {
        const billingData = await api<BillingData>('billing/status');
        setBilling(billingData);
      } catch (reason) {
        if (reason instanceof ApiRequestError && reason.status === 401) setUser(null);
      }
      try {
        const history = await api<{ generations: Generation[] }>('account/generations');
        setGenerations(history.generations);
      } catch { /* Keep account usable if history is temporarily unavailable. */ }
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 401) setUser(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const awaitingPayment = new URLSearchParams(window.location.search).get('checkout') === 'success';
    let attempts = 0;
    const paymentPoller = awaitingPayment ? window.setInterval(() => {
      attempts += 1;
      void load();
      if (attempts >= 10) window.clearInterval(paymentPoller);
    }, 3000) : undefined;
    const refreshOnFocus = () => void load();
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.clearTimeout(timer);
      if (paymentPoller) window.clearInterval(paymentPoller);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [load]);

  async function submitAuth(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await api(`account/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
      setPassword(''); await load();
      const next = new URLSearchParams(window.location.search).get('next');
      if (next?.startsWith('/') && !next.startsWith('//')) window.location.assign(next);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to continue'); }
    finally { setBusy(false); }
  }

  async function requestReset() {
    if (!email) return setMessage('Enter your email first.');
    setBusy(true); setMessage('');
    try {
      const result = await api<{ message: string }>('account/request-reset', { method: 'POST', body: JSON.stringify({ email }) });
      setMessage(result.message || 'Check your inbox for a reset link.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to request reset'); }
    finally { setBusy(false); }
  }

  async function createKey() {
    setBusy(true); setMessage('');
    try {
      const result = await api<{ key: { token: string } }>('account/create-key', { method: 'POST', body: JSON.stringify({ name: 'My AI agent' }) });
      setNewToken(result.key.token); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to create key'); }
    finally { setBusy(false); }
  }

  async function revokeKey(id: string) {
    if (!window.confirm('Revoke this API key? Connected agents using it will stop working.')) return;
    await api('account/revoke-key', { method: 'POST', body: JSON.stringify({ id }) });
    await load();
  }

  async function logout() {
    await api('account/logout', { method: 'POST' });
    setUser(null);
    setKeys([]);
    setNewToken('');
  }

  async function checkout(plan: string) {
    setBusy(true); setMessage('');
    try {
      const result = await api<{ url: string }>('billing/checkout', { method: 'POST', body: JSON.stringify({ plan }) });
      window.location.assign(result.url);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Checkout unavailable'); setBusy(false); }
  }

  async function openBillingPortal() {
    setBusy(true); setMessage('');
    try {
      const result = await api<{ url: string }>('billing/portal', { method: 'POST' });
      window.location.assign(result.url);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Billing portal unavailable'); setBusy(false); }
  }

  async function topup() {
    setBusy(true); setMessage('');
    try { const result = await api<{url:string}>('billing/topup',{method:'POST'}); window.location.assign(result.url); }
    catch(error){setMessage(error instanceof Error?error.message:'Top-up unavailable');setBusy(false);}
  }

  async function deleteAccount() {
    if (!deletePassword || !window.confirm('Permanently delete this account, its API keys, credits, and logo history?')) return;
    setBusy(true); setMessage('');
    try {
      await api('account/delete-account', { method: 'POST', body: JSON.stringify({ password: deletePassword }) });
      window.location.assign('/');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to delete account'); setBusy(false); }
  }

  async function rateGeneration(generationId: string, rating: number) {
    try {
      await api('account/generation-feedback', { method: 'POST', body: JSON.stringify({ generationId, rating }) });
      setMessage('Thanks — your logo rating was recorded.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save rating'); }
  }

  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#d9d3ff] px-5 py-16 text-[#171714]">
        <div className="w-full max-w-md rounded-[2rem] border border-black/10 bg-[#f2f0e9] p-7 shadow-2xl sm:p-9">
          <Link href="/" className="text-xl font-black tracking-[-0.06em]">wordmarks<span className="text-[#ff5c35]">.</span></Link>
          <p className="mt-10 text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Developer account</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.06em]">{mode === 'register' ? 'Create your account.' : 'Welcome back.'}</h1>
          <form className="mt-8 space-y-4" onSubmit={submitAuth}>
            <label className="block text-xs font-bold uppercase tracking-wider">Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-base font-normal normal-case tracking-normal outline-none focus:border-[#5b42d5]" /></label>
            <label className="block text-xs font-bold uppercase tracking-wider">Password<input type="password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-base font-normal normal-case tracking-normal outline-none focus:border-[#5b42d5]" /></label>
            {message ? <p role="alert" className="text-sm text-red-700">{message}</p> : null}
            <button disabled={busy} className="w-full rounded-full bg-[#171714] px-5 py-3.5 text-sm font-black text-white disabled:opacity-50">{busy ? 'Please wait...' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
          </form>
          <button onClick={() => setMode(mode === 'register' ? 'login' : 'register')} className="mt-5 w-full text-sm text-black/55 underline underline-offset-4">{mode === 'register' ? 'Already registered? Sign in' : 'Need an account? Register'}</button>
          {mode === 'login' ? <button type="button" onClick={requestReset} disabled={busy} className="mt-3 w-full text-sm text-black/55 underline underline-offset-4">Forgot password?</button> : null}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f2f0e9] px-5 py-8 text-[#171714] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-black/10 pb-6">
          <Link href="/" className="text-2xl font-black tracking-[-0.06em]">wordmarks<span className="text-[#ff5c35]">.</span></Link>
          <div className="flex items-center gap-4 text-right">
            <div><p className="text-sm font-bold">{user.email}</p><p className="text-xs text-black/45">{user.plan === 'none' ? 'Free beta' : `${user.plan} plan`}</p></div>
            <button onClick={logout} className="rounded-full border border-black/15 px-4 py-2 text-xs font-bold">Sign out</button>
          </div>
        </header>

        <section className="grid gap-5 py-10 md:grid-cols-[0.65fr_1.35fr]">
          <div className="rounded-[2rem] bg-[#171714] p-7 text-white">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#c6ff4a]">Available credits</p>
            <p className="mt-5 text-7xl font-black tracking-[-0.08em]">{user.credits}</p>
            <p className="mt-3 text-sm text-white/45">One credit generates one logo. Unused credits never expire.</p>
            <button disabled={busy} onClick={topup} className="mt-5 rounded-full bg-[#c6ff4a] px-5 py-3 text-xs font-black uppercase text-black disabled:opacity-50">Top up 25 credits · $25</button>
          </div>
          <div className="rounded-[2rem] border border-black/10 bg-white/60 p-7">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Choose your monthly credits</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['lite', '$1', '1'], ['growth', '$3', '4'], ['pro', '$7', '10'], ['scale', '$17', '28']].map(([plan, price, credits]) => (
                <button key={plan} disabled={busy} onClick={() => checkout(plan)} className={`rounded-2xl border bg-white p-4 text-left transition-transform hover:-translate-y-1 disabled:opacity-50 ${requestedPlan===plan?'border-[#5b42d5] ring-4 ring-[#5b42d5]/10':'border-black/10'}`}>
                  <span className="text-xs font-black uppercase">{plan}</span><strong className="mt-4 block text-2xl">{price}<small className="text-xs font-normal text-black/40">/mo</small></strong><span className="mt-1 block text-xs text-black/45">{credits} credits/month</span>
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-black/55"><strong>$25 is charged today</strong> for 25 credits. Your selected monthly plan starts after the 30-day introductory period, then renews monthly until cancelled.</p>
          </div>
        </section>

        {message ? <div role="status" className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4 text-sm ${message.startsWith('Payment received')?'bg-green-100 text-green-800':message.startsWith('Checkout cancelled')?'bg-amber-100 text-amber-800':'bg-red-100 text-red-800'}`}><span>{message}</span>{message.startsWith('Payment received')?<button onClick={() => void load()} className="font-bold underline">Check payment status</button>:null}</div> : null}
        <section className="mb-6 grid gap-5 md:grid-cols-2">
          <div className="rounded-[2rem] border border-black/10 bg-white/60 p-7">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Subscription</p><h2 className="mt-2 text-3xl font-black capitalize">{billing.subscription?.plan || 'No active plan'}</h2></div>
              {billing.subscription ? <span className="rounded-full bg-[#c6ff4a] px-3 py-1 text-[10px] font-black uppercase">{billing.subscription.status}</span> : null}
            </div>
            {billing.subscription?.currentPeriodEnd ? <p className="mt-4 text-sm text-black/55">Next billing date: {new Date(billing.subscription.currentPeriodEnd).toLocaleDateString()}</p> : <p className="mt-4 text-sm text-black/45">Choose a plan above to activate monthly credits.</p>}
            {billing.subscription?.cancelAtPeriodEnd ? <p className="mt-2 text-sm font-bold text-orange-700">Cancellation scheduled at the end of this period.</p> : null}
            {billing.subscription ? <button disabled={busy} onClick={openBillingPortal} className="mt-5 rounded-full bg-[#171714] px-5 py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">Manage billing</button> : null}
          </div>
          <div className="rounded-[2rem] border border-black/10 bg-white/60 p-7">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Recent credit activity</p>
            <div className="mt-4 divide-y divide-black/10">
              {billing.creditHistory.length === 0 ? <p className="py-4 text-sm text-black/45">No credit activity yet.</p> : billing.creditHistory.slice(0, 5).map((entry) => <div key={entry.id} className="flex justify-between gap-4 py-3 text-sm"><span className="capitalize text-black/60">{entry.reason.replaceAll('_', ' ')}</span><span className={entry.amount > 0 ? 'font-bold text-green-700' : 'font-bold text-red-700'}>{entry.amount > 0 ? '+' : ''}{entry.amount}</span></div>)}
            </div>
          </div>
        </section>

        {billing.invoices.length > 0 ? <section className="mb-6 rounded-[2rem] border border-black/10 bg-white/60 p-7">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Payment history</p>
          <div className="mt-4 divide-y divide-black/10">{billing.invoices.map((invoice) => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><p className="font-bold">{invoice.number || 'Stripe invoice'}</p><p className="text-xs text-black/45">{new Date(invoice.createdAt).toLocaleDateString()} · {invoice.status}</p></div><div className="flex items-center gap-4"><strong>{invoice.currency} {(invoice.amountPaid / 100).toFixed(2)}</strong>{invoice.hostedUrl ? <a href={invoice.hostedUrl} target="_blank" rel="noreferrer" className="text-xs font-bold underline">View receipt</a> : null}</div></div>)}</div>
        </section> : null}
        <section className="mb-6 rounded-[2rem] border border-black/10 bg-white/60 p-7">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Logo history</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{generations.length===0?<p className="text-sm text-black/45">No saved logos yet.</p>:generations.map((item)=><article key={item.id} className="rounded-2xl border border-black/10 bg-white p-4">{item.result_url?<img src={item.result_url} alt={`${item.brand_name} logo`} className="aspect-square w-full rounded-xl bg-neutral-100 object-contain"/>:<div className="grid aspect-square place-items-center rounded-xl bg-neutral-100 text-sm text-black/45">{item.status}</div>}<div className="mt-3 flex items-center justify-between gap-3"><div><strong>{item.brand_name}</strong><p className="text-xs text-black/40">{new Date(`${item.created_at}Z`).toLocaleString()}</p></div>{item.result_url?<a href={item.result_url} download={`${item.brand_name}-logo.svg`} className="text-xs font-bold underline">Download</a>:null}</div>{item.status==='completed'?<div className="mt-3 flex items-center gap-1 border-t border-black/10 pt-3"><span className="mr-2 text-[11px] text-black/40">Rate</span>{[1,2,3,4,5].map((rating)=><button key={rating} onClick={() => void rateGeneration(item.id,rating)} aria-label={`Rate ${rating} out of 5`} className="text-lg text-amber-500">★</button>)}</div>:null}</article>)}</div>
        </section>
        {newToken ? (
          <section className="mb-6 rounded-[1.5rem] border border-[#5b42d5]/25 bg-[#d9d3ff] p-6">
            <p className="font-black">Copy this key now. It will not be shown again.</p>
            <code className="mt-3 block overflow-x-auto rounded-xl bg-[#171714] p-4 text-sm text-[#c6ff4a]">{newToken}</code>
            <button onClick={() => navigator.clipboard.writeText(newToken)} className="mt-3 rounded-full bg-[#171714] px-4 py-2 text-xs font-bold text-white">Copy key</button>
          </section>
        ) : null}

        <section className="rounded-[2rem] border border-black/10 bg-white/60 p-7">
          <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Developer API keys</p><h2 className="mt-2 text-3xl font-black tracking-[-0.05em]">Connect your AI agents</h2></div><div className="flex items-center gap-3"><label className="text-xs text-black/50"><input type="checkbox" checked={showRevokedKeys} onChange={(event) => setShowRevokedKeys(event.target.checked)} className="mr-2"/>Show revoked</label><button disabled={busy} onClick={createKey} className="rounded-full bg-[#171714] px-5 py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">Create API key</button></div></div>
          <div className="mt-6 divide-y divide-black/10 border-y border-black/10">
            {keys.filter((key) => showRevokedKeys || !key.revoked_at).length === 0 ? <p className="py-6 text-sm text-black/45">No active API keys.</p> : keys.filter((key) => showRevokedKeys || !key.revoked_at).map((key) => (
              <div key={key.id} className="flex items-center justify-between gap-4 py-4"><div><p className="font-bold">{key.name}</p><code className="text-xs text-black/45">{key.key_prefix}</code><p className="mt-1 text-[11px] text-black/40">{key.last_used_at ? `Last used ${new Date(`${key.last_used_at}Z`).toLocaleString()}` : 'Never used'}</p></div>{key.revoked_at ? <span className="text-xs text-red-600">Revoked</span> : <button onClick={() => revokeKey(key.id)} className="text-xs font-bold text-red-700">Revoke</button>}</div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl bg-[#171714] p-5 text-xs leading-6 text-white/65"><code>Authorization: Bearer wm_live_your_key</code><br /><code>https://wordmarks-v2-dz1.pages.dev/mcp</code></div>
        </section>
        <section className="mt-6 rounded-[2rem] border border-red-200 bg-red-50 p-7">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Danger zone</p>
          <h2 className="mt-2 text-2xl font-black">Delete account</h2>
          <p className="mt-2 text-sm text-red-900/60">This permanently removes your profile, credits, API keys, and logo history. Active subscriptions must be cancelled first. Payment providers may retain invoice and transaction records where legally required.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row"><input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="Confirm your password" className="rounded-xl border border-red-200 bg-white px-4 py-3 text-sm"/><button disabled={busy || !deletePassword} onClick={deleteAccount} className="rounded-full bg-red-700 px-5 py-3 text-xs font-black uppercase text-white disabled:opacity-50">Delete permanently</button></div>
        </section>
      </div>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNotifications } from '@/components/Notifications';

interface User { id: string; email: string; plan: string; credits: number }
interface ApiKey { id: string; name: string; key_prefix: string; created_at: string; last_used_at?: string; revoked_at?: string }
interface Subscription { id: string; plan: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean }
interface Invoice { id: string; number: string; status: string; amountPaid: number; currency: string; createdAt: string; hostedUrl: string | null }
interface CreditEntry { id: string; amount: number; reason: string; created_at: string }
interface BillingData { subscription: Subscription | null; invoices: Invoice[]; creditHistory: CreditEntry[]; reconciliation?: { fulfilled?: boolean; paymentStatus?: string } | null }
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
  const { confirm } = useNotifications();
  const [user, setUser] = useState<User | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newToken, setNewToken] = useState('');
  const [billing, setBilling] = useState<BillingData>({ subscription: null, invoices: [], creditHistory: [] });
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [requestedPlan] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('plan') || '');
  const [message, setMessage] = useState(() => {
    if (typeof window === 'undefined') return '';
    const checkoutState = new URLSearchParams(window.location.search).get('checkout');
    const paypalState = new URLSearchParams(window.location.search).get('paypal');
    const verificationState = new URLSearchParams(window.location.search).get('verification');
    if (new URLSearchParams(window.location.search).get('verified') === '1') return 'Email verified. Your account is now active.';
    if (verificationState === 'invalid') return 'This verification link is invalid or expired. Sign in and request a new one.';
    if (checkoutState === 'success') return 'Payment received. Credits may take a few seconds to appear.';
    if (checkoutState === 'cancelled') return 'Checkout cancelled. You were not charged.';
    if (paypalState === 'cancelled') return 'PayPal checkout cancelled. You were not charged.';
    return '';
  });
  const [busy, setBusy] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [showRevokedKeys, setShowRevokedKeys] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');

  const load = useCallback(async (reconcile = false) => {
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
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('session_id');
        const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : reconcile ? '?reconcile=1' : '';
        const billingData = await api<BillingData>(`billing/status${query}`);
        setBilling(billingData);
        if (billingData.reconciliation?.fulfilled) {
          const refreshed = await api<{ user: User }>('account/me');
          setUser(refreshed.user);
          setMessage('Payment confirmed. Your credits are ready.');
        } else if (reconcile && billingData.reconciliation?.paymentStatus === 'not_found') {
          setMessage('No paid checkout was found yet. If you just paid, wait a few seconds and try again.');
        }
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
    const restoreFromHistory = () => setBusy(false);
    window.addEventListener('pageshow', restoreFromHistory);
    const timer = window.setTimeout(() => void load(), 0);

    // Handle PayPal return
    const params = new URLSearchParams(window.location.search);
    const paypalState = params.get('paypal');
    const paypalOrderId = params.get('order_id') || params.get('token');

    if (paypalState === 'success' && paypalOrderId) {
      setBusy(true);
      api<{ ok: boolean; creditsAdded: number; newCredits: number }>('billing/paypal-capture-order', {
        method: 'POST',
        body: JSON.stringify({ orderId: paypalOrderId }),
      }).then(async (res) => {
        setMessage(`Payment received via PayPal! Added ${res.creditsAdded} credits to your account.`);
        await load();
      }).catch((err) => {
        setMessage(err instanceof Error ? err.message : 'PayPal payment processing failed');
      }).finally(() => {
        setBusy(false);
      });
    }

    const awaitingPayment = new URLSearchParams(window.location.search).get('checkout') === 'success';
    let attempts = 0;
    const paymentPoller = awaitingPayment ? window.setInterval(() => {
      attempts += 1;
      void load(true);
      if (attempts >= 10) window.clearInterval(paymentPoller);
    }, 3000) : undefined;
    const refreshOnFocus = () => void load();
    const refreshOnVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    // MCP requests happen outside this browser tab, so keep the displayed
    // balance in sync while the Account page remains open.
    const accountPoller = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 10_000);
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisibility);
    return () => {
      window.removeEventListener('pageshow', restoreFromHistory);
      window.clearTimeout(timer);
      if (paymentPoller) window.clearInterval(paymentPoller);
      window.clearInterval(accountPoller);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, [load]);

  async function submitAuth(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await api<{ verificationRequired?: boolean; email?: string; message?: string }>(`account/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
      if (result.verificationRequired) {
        setVerificationEmail(result.email || email);
        setMessage(result.message || 'Check your email to activate your account.');
        setPassword('');
        return;
      }
      setPassword(''); await load();
      const next = new URLSearchParams(window.location.search).get('next');
      if (next?.startsWith('/') && !next.startsWith('//')) window.location.assign(next);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to continue';
      if (text.toLowerCase().includes('verify your email')) setVerificationEmail(email);
      setMessage(text);
    }
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

  async function resendVerification() {
    if (!verificationEmail) return;
    setBusy(true); setMessage('');
    try {
      const result = await api<{ message: string }>('account/resend-verification', { method: 'POST', body: JSON.stringify({ email: verificationEmail }) });
      setMessage(result.message || 'A new verification email has been sent.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to resend verification'); }
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
    if (!await confirm({ title: 'Revoke API key?', message: 'Connected AI agents using this key will stop working immediately.', confirmLabel: 'Revoke key', tone: 'danger' })) return;
    await api('account/revoke-key', { method: 'POST', body: JSON.stringify({ id }) });
    await load();
  }

  async function logout() {
    await api('account/logout', { method: 'POST' });
    setUser(null);
    setKeys([]);
    setNewToken('');
    localStorage.removeItem('wordmarks:draft');
    sessionStorage.removeItem('wordmarks:last-result');
  }

  async function checkout(plan: string) {
    return paypalCheckout(plan);
  }

  async function paypalCheckout(product: string = 'topup') {
    setBusy(true); setMessage('');
    try {
      const result = await api<{ url: string }>('billing/paypal-create-order', {
        method: 'POST',
        body: JSON.stringify({ product }),
      });
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'PayPal checkout unavailable');
      setBusy(false);
    }
  }

  async function openBillingPortal() {
    setBusy(true); setMessage('');
    try {
      const result = await api<{ url: string }>('billing/portal', { method: 'POST' });
      window.location.assign(result.url);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Billing portal unavailable'); setBusy(false); }
  }

  async function cancelSubscriptionNow() {
    if (!await confirm({ title: 'End subscription now?', message: 'Future renewals will stop immediately. Your existing credits will remain available.', confirmLabel: 'End subscription', tone: 'danger' })) return;
    setBusy(true); setMessage('');
    try {
      await api('billing/cancel-now', { method: 'POST' });
      setMessage('Subscription cancelled immediately. Your existing credits remain available.');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to cancel subscription'); }
    finally { setBusy(false); }
  }

  async function topup() {
    return paypalCheckout('topup');
  }

  async function deleteAccount() {
    if (!deletePassword || !await confirm({ title: 'Permanently delete account?', message: 'Your API keys, credits, and logo history will be deleted. This action cannot be undone.', confirmLabel: 'Delete account', tone: 'danger' })) return;
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
    if (verificationEmail) return (
      <main className="grid min-h-screen place-items-center bg-[#d9d3ff] px-5 py-16 text-[#171714]">
        <div className="w-full max-w-md rounded-[2rem] border border-black/10 bg-[#f2f0e9] p-8 text-center shadow-2xl">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#c6ff4a] text-3xl">✉</div>
          <h1 className="mt-6 text-4xl font-black tracking-[-0.06em]">Check your email.</h1>
          <p className="mt-4 text-sm leading-6 text-black/55">We sent an activation link to <strong className="text-black">{verificationEmail}</strong>. Open it within 24 hours before signing in or generating a logo.</p>
          {message ? <p role="status" className="mt-4 rounded-xl bg-black/[0.05] px-4 py-3 text-sm">{message}</p> : null}
          <button disabled={busy} onClick={resendVerification} className="mt-6 w-full rounded-full bg-[#171714] px-5 py-3.5 text-sm font-black text-white disabled:opacity-50">{busy ? 'Sending…' : 'Resend verification email'}</button>
          <button onClick={() => { setVerificationEmail(''); setMode('login'); setMessage(''); }} className="mt-4 text-sm text-black/50 underline underline-offset-4">Back to sign in</button>
        </div>
      </main>
    );
    return (
      <main className="grid min-h-screen place-items-center bg-[#d9d3ff] px-5 py-16 text-[#171714]">
        <div className="w-full max-w-md rounded-[2rem] border border-black/10 bg-[#f2f0e9] p-7 shadow-2xl sm:p-9">
          <Link href="/" className="text-xl font-black tracking-[-0.06em]">wordmarks<span className="text-[#ff5c35]">.</span></Link>
          <p className="mt-10 text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Direct purchase account</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.06em]">{mode === 'register' ? 'Create your account.' : 'Welcome back.'}</h1>
          <p className="mt-2 text-xs text-black/50">Direct purchase · No free trial. Buy credits to start generating.</p>
          <form className="mt-8 space-y-4" onSubmit={submitAuth}>
            <label className="block text-xs font-bold uppercase tracking-wider">Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-base font-normal normal-case tracking-normal outline-none focus:border-[#5b42d5]" /></label>
            <label className="block text-xs font-bold uppercase tracking-wider">Password<input type="password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-base font-normal normal-case tracking-normal outline-none focus:border-[#5b42d5]" /></label>
            {message ? <p role="alert" className="text-sm text-red-700">{message}</p> : null}
            <button disabled={busy} className="w-full rounded-full bg-[#171714] px-5 py-3.5 text-sm font-black text-white disabled:opacity-50">{busy ? 'Please wait...' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
          </form>
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'register' ? 'login' : 'register');
              setMessage('');
            }}
            className="mt-5 w-full text-sm text-black/55 underline underline-offset-4"
          >
            {mode === 'register' ? 'Already registered? Sign in' : 'Need an account? Register'}
          </button>
          {mode === 'login' ? <button type="button" onClick={requestReset} disabled={busy} className="mt-3 w-full text-sm text-black/55 underline underline-offset-4">Forgot password?</button> : null}
        </div>
      </main>
    );
  }

  const isPayPalUnconfigured = message.toLowerCase().includes('paypal is not configured');

  return (
    <main className="min-h-screen bg-[#f7f6f2] px-5 py-8 text-[#171714] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-black/10 pb-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-2xl font-black tracking-[-0.06em]">wordmarks<span className="text-[#ff5c35]">.</span></Link>
            <Link href="/" className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-black/50 hover:text-black sm:inline-block">← Back to Studio</Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-black/10 bg-white px-4 py-1.5 text-right shadow-sm">
              <span className="text-xs font-bold text-[#171714]">{user.email}</span>
              <span className="mx-2 text-black/20">|</span>
              <span className="text-xs font-medium text-black/50">{user.credits} credits</span>
            </div>
            <button onClick={logout} className="rounded-full border border-black/15 bg-white px-4 py-2 text-xs font-bold transition hover:bg-black/5">Sign out</button>
          </div>
        </header>

        {/* Status and notification banner */}
        {message ? (
          isPayPalUnconfigured ? (
            <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50/90 p-5 text-amber-950 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-amber-200 p-1.5 text-amber-900 text-sm leading-none">⚙️</div>
                  <div>
                    <h3 className="text-sm font-bold">PayPal Payment Gateway Setup in Progress</h3>
                    <p className="mt-0.5 text-xs text-amber-900/80">PayPal credentials have not been configured yet. If you are the store administrator, please enter your PayPal Client ID and Secret in Admin Studio.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link href="/admin/billing" className="rounded-full bg-amber-900 px-4 py-2 text-xs font-black text-white hover:bg-black transition">Open Admin Billing →</Link>
                  <button onClick={() => setMessage('')} className="rounded-full px-2.5 py-1.5 text-xs font-bold text-amber-750 hover:text-black">✕</button>
                </div>
              </div>
            </div>
          ) : (
            <div role="status" className={`mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 text-sm font-medium shadow-sm ${
              message.startsWith('Payment received') || message.startsWith('Payment confirmed')
                ? 'border border-emerald-300 bg-emerald-50 text-emerald-950'
                : message.includes('cancelled')
                ? 'border border-black/10 bg-white text-black/75'
                : 'border border-red-200 bg-red-50 text-red-900'
            }`}>
              <div className="flex items-center gap-2.5">
                <span>{message.startsWith('Payment received') || message.startsWith('Payment confirmed') ? '🎉' : message.includes('cancelled') ? 'ℹ️' : '⚠️'}</span>
                <span>{message}</span>
              </div>
              <div className="flex items-center gap-2">
                {message.startsWith('Payment received') ? (
                  <button onClick={() => void load(true)} className="rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800">Check Balance</button>
                ) : null}
                <button onClick={() => setMessage('')} className="text-xs font-bold opacity-60 hover:opacity-100">✕ Dismiss</button>
              </div>
            </div>
          )
        ) : null}

        {/* Hero Billing / Credits Section */}
        <section className="grid gap-6 py-8 lg:grid-cols-[0.75fr_1.25fr]">
          {/* Credit Balance Card */}
          <div className="flex flex-col justify-between rounded-[2rem] bg-[#121210] p-8 text-white shadow-xl">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#c6ff4a]">Available Balance</span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/70">Direct Purchase</span>
              </div>
              <div className="mt-6 flex items-baseline gap-3">
                <span className="text-7xl font-black tracking-[-0.07em] text-white sm:text-8xl">{user.credits}</span>
                <span className="text-sm font-bold uppercase tracking-wider text-white/40">credits</span>
              </div>
              <p className="mt-4 text-xs leading-5 text-white/60">
                1 credit generates 1 logo export (SVG + PNG + WebP). Direct purchase only · No free trial. Unused credits never expire.
              </p>
            </div>

            <div className="mt-8 border-t border-white/10 pt-6">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Instant Refill Pack</p>
              <button
                disabled={busy}
                onClick={() => paypalCheckout('topup')}
                className="mt-3 w-full rounded-2xl bg-[#c6ff4a] hover:bg-[#b5f532] px-6 py-4 text-left font-black text-black shadow-lg shadow-[#c6ff4a]/20 transition-all hover:-translate-y-0.5 disabled:opacity-50 flex items-center justify-between"
              >
                <div>
                  <span className="block text-sm font-black uppercase tracking-wider">Top Up 25 Credits</span>
                  <span className="block text-[11px] font-medium text-black/70">Card or PayPal · $1.00 per credit</span>
                </div>
                <span className="rounded-full bg-black px-3 py-1.5 text-xs font-black text-white">$25</span>
              </button>
              <p className="mt-3 text-center text-[10px] text-white/45">
                🔒 Powered by PayPal · Accepts Debit/Credit Card or PayPal account
              </p>
            </div>
          </div>

          {/* Monthly Plans Section */}
          <div className="flex flex-col justify-between rounded-[2rem] border border-black/10 bg-white p-7 sm:p-8 shadow-sm">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 pb-4">
                <div>
                  <h2 className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Choose Your Monthly Plan</h2>
                  <p className="mt-0.5 text-xs text-black/50">Credits deposit immediately · Cancel or switch anytime</p>
                </div>
                <span className="rounded-full bg-[#5b42d5]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#5b42d5]">
                  Instant Activation
                </span>
              </div>

              {/* 4 Plan Cards */}
              <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {[
                  { key: 'lite', name: 'Lite', price: '$1', credits: '1', effective: '$1.00', featured: false },
                  { key: 'growth', name: 'Growth', price: '$3', credits: '4', effective: '$0.75', featured: false },
                  { key: 'pro', name: 'Pro', price: '$7', credits: '10', effective: '$0.70', featured: true },
                  { key: 'scale', name: 'Scale', price: '$17', credits: '28', effective: '$0.60', featured: false },
                ].map((plan) => {
                  const isSelected = requestedPlan === plan.key;
                  return (
                    <div
                      key={plan.key}
                      className={`relative flex flex-col justify-between rounded-2xl p-4 transition-all ${
                        plan.featured
                          ? 'border-2 border-[#5b42d5] bg-[#5b42d5]/[0.03] shadow-md ring-2 ring-[#5b42d5]/10'
                          : isSelected
                          ? 'border-2 border-black bg-black/[0.02]'
                          : 'border border-black/10 bg-white hover:border-black/25'
                      }`}
                    >
                      {plan.featured ? (
                        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-[#5b42d5] px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
                          Best Value
                        </span>
                      ) : null}

                      <div>
                        <span className="text-[11px] font-black uppercase tracking-wider text-black/60">{plan.name}</span>
                        <div className="mt-2 flex items-baseline gap-1">
                          <span className="text-3xl font-black tracking-[-0.05em]">{plan.price}</span>
                          <span className="text-xs text-black/45">/mo</span>
                        </div>
                        <p className="mt-2 text-xs font-bold text-black">{plan.credits} {plan.credits === '1' ? 'credit' : 'credits'}<span className="text-[10px] font-normal text-black/45">/mo</span></p>
                        <span className="mt-0.5 block text-[10px] text-black/40">{plan.effective}/logo</span>
                      </div>

                      <div className="mt-5 pt-3 border-t border-black/5">
                        <button
                          disabled={busy || Boolean(billing.subscription)}
                          onClick={() => paypalCheckout(plan.key)}
                          className={`w-full rounded-xl py-2.5 text-center text-xs font-black uppercase tracking-wider transition-all disabled:opacity-40 ${
                            plan.featured
                              ? 'bg-[#121210] hover:bg-black text-[#c6ff4a] shadow-sm'
                              : 'bg-black/5 hover:bg-black/10 text-[#171714] border border-black/10'
                          }`}
                        >
                          Select {plan.name}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Trust Footer */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-4 text-xs text-black/55">
              <div className="flex flex-wrap items-center gap-4 text-[11px]">
                <span className="flex items-center gap-1.5 font-semibold text-black/70">
                  <span>🔒</span> PayPal & Card Checkout
                </span>
                <span>•</span>
                <span>Unused credits roll over</span>
                <span>•</span>
                <span>Cancel anytime</span>
              </div>
              {billing.subscription ? (
                <span className="font-bold text-[#5b42d5]">Active membership in place</span>
              ) : null}
            </div>
          </div>
        </section>

        {/* Subscription details & Credit Activity */}
        <section className="mb-6 grid gap-6 md:grid-cols-2">
          <div className="rounded-[2rem] border border-black/10 bg-white p-7 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Membership Status</p>
                <h2 className="mt-2 text-3xl font-black capitalize">{billing.subscription?.plan || 'No Active Plan'}</h2>
              </div>
              {billing.subscription ? (
                <span className="rounded-full bg-[#c6ff4a] px-3 py-1 text-[10px] font-black uppercase text-black">{billing.subscription.status}</span>
              ) : null}
            </div>
            {billing.subscription?.currentPeriodEnd ? (
              <p className="mt-4 text-sm text-black/55">{billing.subscription.cancelAtPeriodEnd ? 'Access until' : 'Next billing date'}: {new Date(billing.subscription.currentPeriodEnd).toLocaleDateString()}</p>
            ) : (
              <p className="mt-4 text-sm text-black/45">{billing.subscription ? 'Billing active.' : 'Select a plan above to receive recurring monthly credits.'}</p>
            )}
            {billing.subscription?.cancelAtPeriodEnd ? (
              <p className="mt-2 text-sm font-bold text-orange-700">Cancellation is scheduled, but access remains active until the date above.</p>
            ) : null}
            {billing.subscription ? (
              <div className="mt-5 flex flex-wrap gap-3">
                <button disabled={busy} onClick={openBillingPortal} className="rounded-full bg-[#171714] px-5 py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">Manage billing</button>
                {billing.subscription.cancelAtPeriodEnd ? (
                  <button disabled={busy} onClick={cancelSubscriptionNow} className="rounded-full border border-red-600 px-5 py-3 text-xs font-black uppercase tracking-wider text-red-700 disabled:opacity-50">End subscription now</button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-[2rem] border border-black/10 bg-white p-7 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Recent Credit Activity</p>
            <div className="mt-4 divide-y divide-black/10">
              {billing.creditHistory.length === 0 ? (
                <p className="py-4 text-sm text-black/45">No credit transactions yet.</p>
              ) : (
                billing.creditHistory.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="flex justify-between gap-4 py-3 text-sm">
                    <span className="capitalize text-black/60">{entry.reason.replaceAll('_', ' ')}</span>
                    <span className={entry.amount > 0 ? 'font-bold text-green-700' : 'font-bold text-red-700'}>
                      {entry.amount > 0 ? '+' : ''}{entry.amount}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {billing.invoices.length > 0 ? (
          <section className="mb-6 rounded-[2rem] border border-black/10 bg-white p-7 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Payment History</p>
            <div className="mt-4 divide-y divide-black/10">
              {billing.invoices.map((invoice) => (
                <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-bold">{invoice.number || 'Payment Invoice'}</p>
                    <p className="text-xs text-black/45">{new Date(invoice.createdAt).toLocaleDateString()} · {invoice.status}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <strong>{invoice.currency} {(invoice.amountPaid / 100).toFixed(2)}</strong>
                    {invoice.hostedUrl ? <a href={invoice.hostedUrl} target="_blank" rel="noreferrer" className="text-xs font-bold underline">View receipt</a> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Logo History */}
        <section className="mb-6 rounded-[2rem] border border-black/10 bg-white p-7 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Saved Logos</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {generations.length === 0 ? (
              <p className="text-sm text-black/45">No saved logos yet.</p>
            ) : (
              generations.map((item) => {
                const extension = item.result_url?.startsWith('data:image/svg+xml') ? 'svg'
                  : item.result_url?.startsWith('data:image/webp') ? 'webp'
                  : item.result_url?.startsWith('data:image/jpeg') ? 'jpg' : 'png';
                return (
                  <article key={item.id} className="rounded-2xl border border-black/10 bg-[#faf9f6] p-4">
                    {item.result_url ? (
                      <img src={item.result_url} alt={`${item.brand_name} logo`} className="aspect-square w-full rounded-xl bg-white object-contain p-2 shadow-inner"/>
                    ) : (
                      <div className="grid aspect-square place-items-center rounded-xl bg-neutral-100 text-sm text-black/45">{item.status}</div>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div>
                        <strong>{item.brand_name}</strong>
                        <p className="text-xs text-black/40">{new Date(`${item.created_at}Z`).toLocaleString()}</p>
                      </div>
                      {item.result_url ? (
                        <a href={item.result_url} download={`${item.brand_name}-logo.${extension}`} className="text-xs font-bold underline">Download {extension.toUpperCase()}</a>
                      ) : null}
                    </div>
                    {item.status === 'completed' ? (
                      <div className="mt-3 flex items-center gap-1 border-t border-black/10 pt-3">
                        <span className="mr-2 text-[11px] text-black/40">Rate</span>
                        {[1, 2, 3, 4, 5].map((rating) => (
                          <button key={rating} onClick={() => void rateGeneration(item.id, rating)} aria-label={`Rate ${rating} out of 5`} className="text-lg text-amber-500">★</button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </section>

        {newToken ? (
          <section className="mb-6 rounded-[1.5rem] border border-[#5b42d5]/25 bg-[#d9d3ff] p-6 shadow-sm">
            <p className="font-black">Copy this API key now. It will not be shown again.</p>
            <code className="mt-3 block overflow-x-auto rounded-xl bg-[#171714] p-4 text-sm text-[#c6ff4a]">{newToken}</code>
            <button onClick={() => navigator.clipboard.writeText(newToken)} className="mt-3 rounded-full bg-[#171714] px-4 py-2 text-xs font-bold text-white">Copy key</button>
          </section>
        ) : null}

        {/* Developer API Keys */}
        <section className="rounded-[2rem] border border-black/10 bg-white p-7 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Developer API Keys</p>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.05em]">Connect your AI agents</h2>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-black/50">
                <input type="checkbox" checked={showRevokedKeys} onChange={(event) => setShowRevokedKeys(event.target.checked)} className="mr-2"/>
                Show revoked
              </label>
              <button disabled={busy} onClick={createKey} className="rounded-full bg-[#171714] px-5 py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">Create API key</button>
            </div>
          </div>
          <div className="mt-6 divide-y divide-black/10 border-y border-black/10">
            {keys.filter((key) => showRevokedKeys || !key.revoked_at).length === 0 ? (
              <p className="py-6 text-sm text-black/45">No active API keys.</p>
            ) : (
              keys.filter((key) => showRevokedKeys || !key.revoked_at).map((key) => (
                <div key={key.id} className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <p className="font-bold">{key.name}</p>
                    <code className="text-xs text-black/45">{key.key_prefix}</code>
                    <p className="mt-1 text-[11px] text-black/40">{key.last_used_at ? `Last used ${new Date(`${key.last_used_at}Z`).toLocaleString()}` : 'Never used'}</p>
                  </div>
                  {key.revoked_at ? (
                    <span className="text-xs text-red-600">Revoked</span>
                  ) : (
                    <button onClick={() => revokeKey(key.id)} className="text-xs font-bold text-red-700">Revoke</button>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="mt-6 rounded-2xl bg-[#171714] p-5 text-xs leading-6 text-white/65">
            <code>Authorization: Bearer wm_live_your_key</code><br />
            <code>https://wordmarks.net/mcp</code>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="mt-6 rounded-[2rem] border border-red-200 bg-red-50/60 p-7">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Danger zone</p>
          <h2 className="mt-2 text-2xl font-black">Delete account</h2>
          <p className="mt-2 text-sm text-red-900/60">This permanently removes your profile, credits, API keys, and logo history. Active subscriptions must be cancelled first. Payment providers may retain invoice and transaction records where legally required.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="Confirm your password" className="rounded-xl border border-red-200 bg-white px-4 py-3 text-sm"/>
            <button disabled={busy || !deletePassword} onClick={deleteAccount} className="rounded-full bg-red-700 px-5 py-3 text-xs font-black uppercase text-white disabled:opacity-50">Delete permanently</button>
          </div>
        </section>
      </div>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';

interface User { id: string; email: string; plan: string; credits: number }
interface ApiKey { id: string; name: string; key_prefix: string; created_at: string; last_used_at?: string; revoked_at?: string }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newToken, setNewToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await api<{ user: User }>('account/me');
      setUser(me.user);
      const keyData = await api<{ keys: ApiKey[] }>('account/keys');
      setKeys(keyData.keys);
    } catch { setUser(null); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 10_000);
    const refreshOnFocus = () => void load();
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [load]);

  async function submitAuth(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await api(`account/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
      setPassword(''); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to continue'); }
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
            <div><p className="text-sm font-bold">{user.email}</p><p className="text-xs text-black/45">{user.plan} plan</p></div>
            <button onClick={logout} className="rounded-full border border-black/15 px-4 py-2 text-xs font-bold">Sign out</button>
          </div>
        </header>

        <section className="grid gap-5 py-10 md:grid-cols-[0.65fr_1.35fr]">
          <div className="rounded-[2rem] bg-[#171714] p-7 text-white">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#c6ff4a]">Available credits</p>
            <p className="mt-5 text-7xl font-black tracking-[-0.08em]">{user.credits}</p>
            <p className="mt-3 text-sm text-white/45">One credit generates one logo. Unused credits never expire.</p>
          </div>
          <div className="rounded-[2rem] border border-black/10 bg-white/60 p-7">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Choose your monthly credits</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['lite', '$1', '1'], ['growth', '$3', '4'], ['pro', '$7', '10'], ['scale', '$17', '28']].map(([plan, price, credits]) => (
                <button key={plan} disabled={busy} onClick={() => checkout(plan)} className="rounded-2xl border border-black/10 bg-white p-4 text-left transition-transform hover:-translate-y-1 disabled:opacity-50">
                  <span className="text-xs font-black uppercase">{plan}</span><strong className="mt-4 block text-2xl">{price}<small className="text-xs font-normal text-black/40">/mo</small></strong><span className="mt-1 block text-xs text-black/45">{credits} credits/month</span>
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-black/45">Every plan includes the unchanged $25 initial pack with 25 credits.</p>
          </div>
        </section>

        {message ? <p role="alert" className="mb-5 rounded-xl bg-red-100 p-4 text-sm text-red-800">{message}</p> : null}
        {newToken ? (
          <section className="mb-6 rounded-[1.5rem] border border-[#5b42d5]/25 bg-[#d9d3ff] p-6">
            <p className="font-black">Copy this key now. It will not be shown again.</p>
            <code className="mt-3 block overflow-x-auto rounded-xl bg-[#171714] p-4 text-sm text-[#c6ff4a]">{newToken}</code>
            <button onClick={() => navigator.clipboard.writeText(newToken)} className="mt-3 rounded-full bg-[#171714] px-4 py-2 text-xs font-bold text-white">Copy key</button>
          </section>
        ) : null}

        <section className="rounded-[2rem] border border-black/10 bg-white/60 p-7">
          <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-[#5b42d5]">Developer API keys</p><h2 className="mt-2 text-3xl font-black tracking-[-0.05em]">Connect your AI agents</h2></div><button disabled={busy} onClick={createKey} className="rounded-full bg-[#171714] px-5 py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">Create API key</button></div>
          <div className="mt-6 divide-y divide-black/10 border-y border-black/10">
            {keys.length === 0 ? <p className="py-6 text-sm text-black/45">No API keys yet.</p> : keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between gap-4 py-4"><div><p className="font-bold">{key.name}</p><code className="text-xs text-black/45">{key.key_prefix}</code><p className="mt-1 text-[11px] text-black/40">{key.last_used_at ? `Last used ${new Date(`${key.last_used_at}Z`).toLocaleString()}` : 'Never used'}</p></div>{key.revoked_at ? <span className="text-xs text-red-600">Revoked</span> : <button onClick={() => revokeKey(key.id)} className="text-xs font-bold text-red-700">Revoke</button>}</div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl bg-[#171714] p-5 text-xs leading-6 text-white/65"><code>Authorization: Bearer wm_live_your_key</code><br /><code>https://wordmarks-v2-dz1.pages.dev/mcp</code></div>
        </section>
      </div>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

export default function AdminLoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/v1/admin-auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to sign in');
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.assign(next?.startsWith('/admin') ? next : '/admin');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in');
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#d9d3ff] px-5 py-12 text-[#191916]">
      <section className="w-full max-w-md rounded-[2rem] border border-black/10 bg-[#eeece5] p-8 shadow-2xl">
        <Link href="/" className="text-xl font-black tracking-[-0.06em]">wordmarks<span className="text-[#ff5c35]">.</span></Link>
        <p className="mt-10 text-[10px] font-black uppercase tracking-[0.2em] text-[#765ee8]">Protected workspace</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-0.055em]">Studio Admin</h1>
        <p className="mt-3 text-sm leading-6 text-black/50">Enter the private administrator password to continue.</p>
        <form onSubmit={login} className="mt-8 space-y-4">
          <label className="block text-xs font-bold uppercase tracking-wider">Admin password
            <input autoFocus required type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-base font-normal normal-case tracking-normal outline-none focus:border-[#765ee8]" />
          </label>
          {error ? <p role="alert" className="rounded-xl bg-red-100 px-4 py-3 text-sm text-red-700">{error}</p> : null}
          <button disabled={busy} className="w-full rounded-full bg-[#191916] px-5 py-3.5 text-sm font-black text-white disabled:opacity-50">{busy ? 'Signing in...' : 'Sign in securely'}</button>
        </form>
      </section>
    </main>
  );
}

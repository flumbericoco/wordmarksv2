'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

export default function ResetPage() {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const token = new URLSearchParams(window.location.search).get('token');
      const response = await fetch('/api/v1/account/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json() as { error?: string };
      setMessage(response.ok ? 'Password updated. You can sign in now.' : data.error || 'Reset failed');
    } catch {
      setMessage('Unable to update password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#d9d3ff] p-6 text-[#191916]">
      <form onSubmit={submit} className="w-full max-w-md rounded-[32px] border border-black/10 bg-white p-8 shadow-xl sm:p-10">
        <h1 className="text-4xl font-black tracking-[-0.05em] text-[#191916]">Reset password</h1>
        <p className="mt-3 text-sm leading-6 text-[#595955]">Enter a new password with at least 10 characters.</p>
        <label htmlFor="new-password" className="mt-8 block text-xs font-black uppercase tracking-[0.14em] text-[#373733]">New password</label>
        <input id="new-password" type="password" minLength={10} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters" className="mt-2 w-full rounded-xl border border-black/20 bg-white p-3.5 text-[#191916] outline-none placeholder:text-[#777770] focus:border-[#6447e8] focus:ring-2 focus:ring-[#6447e8]/20" />
        <button disabled={submitting} className="mt-5 w-full rounded-xl bg-[#191916] p-3.5 font-bold text-white disabled:cursor-wait disabled:opacity-60">{submitting ? 'Updating…' : 'Update password'}</button>
        {message ? <p role="status" className="mt-4 rounded-xl bg-[#f5f3ed] p-3 text-sm text-[#373733]">{message}</p> : null}
        <Link href="/account" className="mt-6 inline-block text-sm font-bold text-[#373733] underline decoration-2 underline-offset-4 hover:text-[#6447e8]">Back to sign in</Link>
      </form>
    </main>
  );
}

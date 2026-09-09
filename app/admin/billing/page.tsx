'use client';

import { FormEvent, useEffect, useState } from 'react';

type Data = {
  transactions: Array<Record<string, string | number>>;
  failedEvents: Array<Record<string, string>>;
  users: Array<{ id: string; email: string; plan: string; credits: number }>;
};

export default function AdminBillingPage() {
  const [data, setData] = useState<Data>({ transactions: [], failedEvents: [], users: [] });
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  async function load() {
    const response = await fetch('/api/v1/admin/billing', { credentials: 'same-origin' });
    if (response.status === 401) return window.location.assign('/admin/login?next=/admin/billing');
    const payload = await response.json() as { data?: Data; error?: string };
    if (!response.ok) throw new Error(payload.error || 'Unable to load billing data');
    setData(payload.data!);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => setMessage(error.message)), 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function adjust(event: FormEvent) {
    event.preventDefault(); setMessage('');
    const selected = data.users.find((user) => user.id === userId);
    if (!window.confirm(`Adjust ${selected?.email || 'this user'} by ${Number(amount) > 0 ? '+' : ''}${amount} credits?\nReason: ${note}`)) return;
    const response = await fetch('/api/v1/admin/billing', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, amount: Number(amount), note }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return setMessage(payload.error || 'Adjustment failed');
    setAmount(''); setNote(''); setMessage('Credit adjustment recorded.'); await load();
  }
  const selectedUser = data.users.find((user) => user.id === userId);
  const projectedBalance = selectedUser && Number.isFinite(Number(amount)) ? selectedUser.credits + Number(amount) : null;
  const matchingTransactions = data.transactions.filter((row) => `${row.email} ${row.kind} ${row.status}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-8">
    <div><p className="text-xs font-black uppercase tracking-widest text-[#765ee8]">Reconciliation</p><h1 className="mt-2 text-5xl font-black tracking-[-0.06em]">Billing & credits</h1></div>
    {message && <p role="status" className="rounded-xl bg-white p-4 text-sm">{message}</p>}
    <form onSubmit={adjust} className="grid gap-3 rounded-3xl border border-black/10 bg-white/60 p-6 md:grid-cols-4">
      <select required value={userId} onChange={(e) => setUserId(e.target.value)} className="rounded-xl border p-3"><option value="">Select user</option>{data.users.map((user) => <option key={user.id} value={user.id}>{user.email} ({user.credits})</option>)}</select>
      <input required type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Credit amount (+/-)" className="rounded-xl border p-3" />
      <input required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" className="rounded-xl border p-3" />
      <button className="rounded-xl bg-black p-3 font-bold text-white">Record adjustment</button>
      {projectedBalance !== null ? <p className={`md:col-span-4 text-sm font-bold ${projectedBalance < 0 ? 'text-red-700' : 'text-black/60'}`}>Balance preview: {selectedUser?.credits} → {projectedBalance} credits</p> : null}
    </form>
    <section className="overflow-x-auto rounded-3xl border border-black/10 bg-white/60 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black">Recent transactions</h2><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search user, kind, status" className="rounded-xl border bg-white px-4 py-2 text-sm"/></div><table className="mt-4 w-full text-left text-sm"><thead><tr><th>User</th><th>Kind</th><th>Amount</th><th>Credits</th><th>Status</th></tr></thead><tbody>{matchingTransactions.map((row) => <tr key={String(row.id)} className="border-t"><td className="py-3">{row.email}</td><td>{row.kind}</td><td>{String(row.currency).toUpperCase()} {(Number(row.amount) / 100).toFixed(2)}</td><td>{row.credits}</td><td>{row.status}</td></tr>)}</tbody></table>{matchingTransactions.length === 0 ? <p className="py-5 text-sm text-black/45">No matching transactions.</p> : null}</section>
    <section className="rounded-3xl border border-black/10 bg-white/60 p-6"><h2 className="text-xl font-black">Failed webhook events</h2>{data.failedEvents.length ? data.failedEvents.map((row) => <p key={row.event_id} className="mt-3 border-t pt-3 text-sm"><strong>{row.event_type}</strong> · {row.error}</p>) : <p className="mt-3 text-sm text-black/45">No failed events.</p>}</section>
  </div>;
}

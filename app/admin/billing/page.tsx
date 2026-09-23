'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useNotifications } from '@/components/Notifications';
import { getSettings, updateSettings, testPayPal, type AdminSettings } from '@/lib/admin-api';

type Data = {
  transactions: Array<Record<string, string | number>>;
  failedEvents: Array<Record<string, string>>;
  users: Array<{ id: string; email: string; plan: string; credits: number }>;
};

export default function AdminBillingPage() {
  const { confirm } = useNotifications();
  const [data, setData] = useState<Data>({ transactions: [], failedEvents: [], users: [] });
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  // PayPal Configuration State
  const [paypalClientId, setPaypalClientId] = useState('');
  const [paypalClientSecret, setPaypalClientSecret] = useState('');
  const [paypalMode, setPaypalMode] = useState<'sandbox' | 'live'>('sandbox');
  const [paypalWebhookId, setPaypalWebhookId] = useState('');
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [secretMasked, setSecretMasked] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [paypalSaving, setPaypalSaving] = useState(false);
  const [paypalSaved, setPaypalSaved] = useState(false);
  const [paypalTesting, setPaypalTesting] = useState(false);
  const [paypalTestResult, setPaypalTestResult] = useState<{ connected: boolean; message?: string; error?: string } | null>(null);

  async function load() {
    const response = await fetch('/api/v1/admin/billing', { credentials: 'same-origin' });
    if (response.status === 401) return window.location.assign('/admin/login?next=/admin/billing');
    const payload = await response.json() as { data?: Data; error?: string };
    if (!response.ok) throw new Error(payload.error || 'Unable to load billing data');
    setData(payload.data!);

    // Load PayPal Settings
    try {
      const s = await getSettings();
      setPaypalClientId(s.paypalClientId || '');
      setPaypalMode(s.paypalMode || 'sandbox');
      setPaypalWebhookId(s.paypalWebhookId || '');
      setSecretConfigured(Boolean(s.paypalClientSecretConfigured));
      setSecretMasked(s.paypalClientSecretMasked || '');
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => setMessage(error.message)), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleSavePayPal(event: FormEvent) {
    event.preventDefault();
    setPaypalSaving(true);
    setPaypalTestResult(null);
    try {
      const payload: Partial<AdminSettings> = {
        paypalClientId,
        paypalMode,
        paypalWebhookId,
      };
      if (paypalClientSecret.trim()) {
        payload.paypalClientSecret = paypalClientSecret.trim();
      }
      const updated = await updateSettings(payload);
      setSecretConfigured(Boolean(updated.paypalClientSecretConfigured));
      setSecretMasked(updated.paypalClientSecretMasked || '');
      setPaypalClientSecret('');
      setPaypalSaved(true);
      setTimeout(() => setPaypalSaved(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save PayPal settings');
    } finally {
      setPaypalSaving(false);
    }
  }

  async function handleTestPayPal() {
    setPaypalTesting(true);
    setPaypalTestResult(null);
    try {
      const res = await testPayPal({
        clientId: paypalClientId.trim() || undefined,
        clientSecret: paypalClientSecret.trim() || undefined,
        mode: paypalMode,
      });
      setPaypalTestResult(res);
    } catch (err) {
      setPaypalTestResult({
        connected: false,
        error: err instanceof Error ? err.message : 'Test failed',
      });
    } finally {
      setPaypalTesting(false);
    }
  }

  async function adjust(event: FormEvent) {
    event.preventDefault(); setMessage('');
    const selected = data.users.find((user) => user.id === userId);
    if (!await confirm({ title: 'Confirm credit adjustment', message: `${selected?.email || 'This user'}\nBalance change: ${Number(amount) > 0 ? '+' : ''}${amount} credits\nReason: ${note}`, confirmLabel: 'Record adjustment', tone: Number(amount) < 0 ? 'danger' : 'default' })) return;
    const response = await fetch('/api/v1/admin/billing', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, amount: Number(amount), note }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return setMessage(payload.error || 'Adjustment failed');
    setAmount(''); setNote(''); setMessage('Credit adjustment recorded.'); await load();
  }

  const selectedUser = data.users.find((user) => user.id === userId);
  const projectedBalance = selectedUser && amount.trim() !== '' && Number.isFinite(Number(amount)) ? selectedUser.credits + Number(amount) : null;
  const matchingTransactions = data.transactions.filter((row) => `${row.email} ${row.kind} ${row.status}`.toLowerCase().includes(search.toLowerCase()));

  const isPayPalActive = Boolean(paypalClientId && secretConfigured);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-[#765ee8]">Payments & Gateways</p>
          <h1 className="mt-2 text-5xl font-black tracking-[-0.06em]">Billing & payments</h1>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white/70 px-4 py-2 text-xs">
          <span className="font-bold text-black">Policy:</span> <span className="font-medium text-black/60">1 Free Trial Credit on Registration · Refill from $1</span>
        </div>
      </div>

      {message && <p role="status" className="rounded-xl bg-white p-4 text-sm font-semibold">{message}</p>}

      {/* ─── PAYPAL GATEWAY CONFIGURATION ─── */}
      <section className="rounded-[2rem] border border-black/10 bg-white/80 p-6 sm:p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/10 pb-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#003087] text-white font-black text-sm">
              PP
            </div>
            <div>
              <h2 className="text-xl font-black text-[#191916]">PayPal Payment Gateway</h2>
              <p className="text-xs text-black/50">Configure your PayPal Client ID and Secret Key to accept direct payments.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${isPayPalActive ? (paypalMode === 'live' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800') : 'bg-amber-100 text-amber-800'}`}>
              <span className={`h-2 w-2 rounded-full ${isPayPalActive ? (paypalMode === 'live' ? 'bg-green-600' : 'bg-blue-600') : 'bg-amber-500'}`} />
              {isPayPalActive ? `Configured (${paypalMode.toUpperCase()})` : 'Not Configured'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSavePayPal} className="mt-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-black/70">
                PayPal Client ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={paypalClientId}
                onChange={(e) => setPaypalClientId(e.target.value)}
                placeholder="e.g. A21AA... or your REST App Client ID"
                className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-[#003087]"
              />
              <p className="mt-1 text-[11px] text-black/45">Found in PayPal Developer Dashboard under Apps &amp; Credentials.</p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-black/70">
                PayPal Secret Key <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={paypalClientSecret}
                  onChange={(e) => setPaypalClientSecret(e.target.value)}
                  placeholder={secretConfigured ? (secretMasked || '•••••••••••• (Leave blank to keep existing)') : 'Enter your PayPal Secret Key'}
                  className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-sm pr-16 outline-none focus:border-[#003087]"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-black/50 hover:text-black"
                >
                  {showSecret ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-black/45">
                {secretConfigured ? '✓ Secret key is currently saved. Input new key only to replace.' : 'Client Secret from your PayPal REST App.'}
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-black/70">
                PayPal Environment
              </label>
              <select
                value={paypalMode}
                onChange={(e) => setPaypalMode(e.target.value as 'sandbox' | 'live')}
                className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-[#003087]"
              >
                <option value="live">Live (Real Money Payments)</option>
                <option value="sandbox">Sandbox (Testing / Development)</option>
              </select>
              <p className="mt-1 text-[11px] text-black/45">Set to Live when using your production PayPal business credentials.</p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-black/70">
                Webhook ID (Optional)
              </label>
              <input
                type="text"
                value={paypalWebhookId}
                onChange={(e) => setPaypalWebhookId(e.target.value)}
                placeholder="e.g. 4JH76582..."
                className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-[#003087]"
              />
              <p className="mt-1 text-[11px] text-black/45">Used for verifying signatures from PayPal Webhooks.</p>
            </div>
          </div>

          {paypalTestResult && (
            <div className={`rounded-xl p-4 text-sm font-medium ${paypalTestResult.connected ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              <p className="font-bold">{paypalTestResult.connected ? '✓ Connection Verified' : '✕ Connection Test Failed'}</p>
              <p className="mt-1 text-xs">{paypalTestResult.message || paypalTestResult.error}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={paypalSaving}
              className="rounded-xl bg-[#003087] hover:bg-[#002466] px-6 py-3 text-sm font-black text-white transition-colors disabled:opacity-50"
            >
              {paypalSaving ? 'Saving...' : paypalSaved ? '✓ Saved!' : 'Save PayPal Credentials'}
            </button>

            <button
              type="button"
              onClick={handleTestPayPal}
              disabled={paypalTesting || (!paypalClientId && !secretConfigured)}
              className="rounded-xl border border-black/15 bg-white hover:bg-black/5 px-5 py-3 text-sm font-bold text-black transition-colors disabled:opacity-40"
            >
              {paypalTesting ? 'Testing Connection...' : '⚡ Test PayPal Connection'}
            </button>

            {paypalSaved && (
              <span className="text-xs font-bold text-green-700">Credentials saved to database.</span>
            )}
          </div>
        </form>
      </section>

      {/* ─── MANUAL RECONCILIATION ─── */}
      <section className="space-y-4">
        <h2 className="text-xl font-black">Manual Credit Adjustment</h2>
        <form onSubmit={adjust} className="grid gap-3 rounded-3xl border border-black/10 bg-white/60 p-6 md:grid-cols-4">
          <select required value={userId} onChange={(e) => setUserId(e.target.value)} className="rounded-xl border p-3"><option value="">Select user</option>{data.users.map((user) => <option key={user.id} value={user.id}>{user.email} ({user.credits})</option>)}</select>
          <input required type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Credit amount (+/-)" className="rounded-xl border p-3" />
          <input required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" className="rounded-xl border p-3" />
          <button className="rounded-xl bg-black p-3 font-bold text-white">Record adjustment</button>
          {projectedBalance !== null ? <p className={`md:col-span-4 text-sm font-bold ${projectedBalance < 0 ? 'text-red-700' : 'text-black/60'}`}>Balance preview: {selectedUser?.credits} → {projectedBalance} credits</p> : null}
        </form>
      </section>

      {/* ─── TRANSACTIONS ─── */}
      <section className="overflow-x-auto rounded-3xl border border-black/10 bg-white/60 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">Recent payment transactions</h2>
            <p className="mt-1 text-xs text-black/45">Includes PayPal and Stripe payments. Manual credit changes are recorded in the audit ledger.</p>
          </div>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search user, kind, status" className="rounded-xl border bg-white px-4 py-2 text-sm"/>
        </div>
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr><th>User</th><th>Kind</th><th>Amount</th><th>Credits</th><th>Status</th></tr>
          </thead>
          <tbody>
            {matchingTransactions.map((row) => (
              <tr key={String(row.id)} className="border-t">
                <td className="py-3 font-medium">{row.email}</td>
                <td>
                  <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${String(row.kind).startsWith('paypal') ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                    {String(row.kind).replace('_', ' ')}
                  </span>
                </td>
                <td>{String(row.currency).toUpperCase()} {(Number(row.amount) / 100).toFixed(2)}</td>
                <td>{row.credits}</td>
                <td><span className="font-bold text-green-700">{row.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {matchingTransactions.length === 0 ? <p className="py-5 text-sm text-black/45">No payment transactions yet.</p> : null}
      </section>

      <section className="rounded-3xl border border-black/10 bg-white/60 p-6">
        <h2 className="text-xl font-black">Failed webhook events</h2>
        {data.failedEvents.length ? data.failedEvents.map((row) => <p key={row.event_id} className="mt-3 border-t pt-3 text-sm"><strong>{row.event_type}</strong> · {row.error}</p>) : <p className="mt-3 text-sm text-black/45">No failed events.</p>}
      </section>
    </div>
  );
}

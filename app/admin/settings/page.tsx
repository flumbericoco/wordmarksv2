'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSettings, updateSettings, exportData, testPayPal, type AdminSettings } from '@/lib/admin-api';

const DEFAULT_SETTINGS: AdminSettings = {
  systemPrompt: '',
  negativePrompt: '',
  defaultProviderId: '',
  maxIterations: 3,
  imageQuality: 'hd',
  imageSize: '1024x1024',
  autoApprove: false,
  knowledgeBaseEnabled: true,
  paypalClientId: '',
  paypalClientSecret: '',
  paypalMode: 'sandbox',
  paypalWebhookId: '',
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ connected: boolean; message?: string; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError(null);
    try {
      const updated = await updateSettings(settings);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
  };

  const handleTestPayPal = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testPayPal({
        clientId: settings.paypalClientId || undefined,
        clientSecret: settings.paypalClientSecret || undefined,
        mode: settings.paypalMode,
      });
      setTestResult(res);
    } catch (e) {
      setTestResult({ connected: false, error: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wordmarks-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="text-sm text-zinc-500">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="admin-page admin-enter space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="mt-1 text-sm text-zinc-400">Configure default behavior, PayPal gateway, and generation parameters</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
          >
            {saved ? '✓ Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* PayPal Payment Gateway Settings */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">PayPal Payment Gateway</h3>
            <Link href="/admin/billing" className="text-xs text-blue-400 hover:underline">
              Open Billing &amp; Reconciliation →
            </Link>
          </div>
          <p className="text-xs leading-5 text-zinc-400">
            Set your PayPal API credentials so users can purchase credits and plans directly. No free trials are granted.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">PayPal Client ID</label>
              <input
                type="text"
                value={settings.paypalClientId || ''}
                onChange={(e) => setSettings({ ...settings, paypalClientId: e.target.value })}
                placeholder="e.g. A21AA... or REST App Client ID"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                PayPal Secret Key {settings.paypalClientSecretConfigured ? '✓ Configured' : ''}
              </label>
              <input
                type="password"
                value={settings.paypalClientSecret || ''}
                onChange={(e) => setSettings({ ...settings, paypalClientSecret: e.target.value })}
                placeholder={settings.paypalClientSecretConfigured ? (settings.paypalClientSecretMasked || '•••••••••••• (Leave blank to keep)') : 'Enter Client Secret'}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Environment</label>
              <select
                value={settings.paypalMode || 'sandbox'}
                onChange={(e) => setSettings({ ...settings, paypalMode: e.target.value as 'sandbox' | 'live' })}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
              >
                <option value="live">Live (Production Payments)</option>
                <option value="sandbox">Sandbox (Testing)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Webhook ID (Optional)</label>
              <input
                type="text"
                value={settings.paypalWebhookId || ''}
                onChange={(e) => setSettings({ ...settings, paypalWebhookId: e.target.value })}
                placeholder="PayPal Webhook ID"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
              />
            </div>
          </div>

          {testResult && (
            <div className={`rounded-lg p-3 text-xs ${testResult.connected ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              {testResult.connected ? `✓ ${testResult.message || 'Connected to PayPal!'}` : `✕ ${testResult.error}`}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleTestPayPal}
              disabled={testing || (!settings.paypalClientId && !settings.paypalClientSecretConfigured)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test PayPal Connection'}
            </button>
          </div>
        </div>

        {/* Image Generation */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-white">Image Generation</h3>
          <p className="text-xs leading-5 text-zinc-500">GPT Image 2.5 currently runs at maximum quality and a landscape production canvas. These values document the fallback behavior for other providers.</p>

          <div className="grid grid-cols-2 gap-4">
            <div className="opacity-60">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Quality</label>
              <select disabled
                value={settings.imageQuality}
                onChange={(e) => setSettings({ ...settings, imageQuality: e.target.value as 'standard' | 'hd' })}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
              >
                <option value="standard">Standard (faster, cheaper)</option>
                <option value="hd">HD (slower, higher quality)</option>
              </select>
            </div>

            <div className="opacity-60">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Size</label>
              <select disabled
                value={settings.imageSize}
                onChange={(e) => setSettings({ ...settings, imageSize: e.target.value as AdminSettings['imageSize'] })}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
              >
                <option value="1024x1024">1024x1024 (Square)</option>
                <option value="1792x1024">1792x1024 (Landscape)</option>
                <option value="1024x1792">1024x1792 (Portrait)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Max Iterations</label>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.maxIterations}
              onChange={(e) => setSettings({ ...settings, maxIterations: parseInt(e.target.value) || 3 })}
              className="w-32 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
            />
            <p className="mt-1 text-xs text-zinc-600">Maximum user-requested improvement rounds retained for one logo workflow.</p>
          </div>
        </div>

        {/* Pipeline */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-white">Pipeline</h3>

          <label className="flex items-center gap-3 cursor-pointer">
            <div
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.autoApprove ? 'bg-blue-500' : 'bg-zinc-600'
              }`}
              onClick={() => setSettings({ ...settings, autoApprove: !settings.autoApprove })}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.autoApprove ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </div>
            <div>
              <p className="text-sm text-white">Auto-review quality</p>
              <p className="text-xs text-zinc-500">Run an extra AI request after every successful generation. It uses no user credit, but adds provider cost and processing time.</p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <div
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.knowledgeBaseEnabled ? 'bg-blue-500' : 'bg-zinc-600'
              }`}
              onClick={() => setSettings({ ...settings, knowledgeBaseEnabled: !settings.knowledgeBaseEnabled })}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.knowledgeBaseEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </div>
            <div>
              <p className="text-sm text-white">Knowledge Base</p>
              <p className="text-xs text-zinc-500">Include curated reference descriptions and tags in generation prompts</p>
            </div>
          </label>
        </div>

        {/* Data Management */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-white">Data Management</h3>
          <p className="text-xs text-zinc-500">
            All data is stored server-side in Cloudflare D1. Export includes metadata only (API keys are redacted).
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
            >
              Export All Data (Redacted)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

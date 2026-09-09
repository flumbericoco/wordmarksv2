'use client';

import { useEffect, useState } from 'react';
import { getSettings, updateSettings, exportData, type AdminSettings } from '@/lib/admin-api';

const DEFAULT_SETTINGS: AdminSettings = {
  defaultProviderId: '',
  maxIterations: 3,
  imageQuality: 'hd',
  imageSize: '1024x1024',
  autoApprove: false,
  knowledgeBaseEnabled: true,
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError(null);
    try {
      await updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
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
          <p className="mt-1 text-sm text-zinc-400">Configure default behavior and generation parameters</p>
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
        {/* Image Generation */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-white">Image Generation</h3>
          <p className="text-xs leading-5 text-zinc-500">Quality and size apply only when an image-model provider returns raster artwork. SVG wordmarks are vector output and ignore these two settings.</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Quality</label>
              <select
                value={settings.imageQuality}
                onChange={(e) => setSettings({ ...settings, imageQuality: e.target.value as 'standard' | 'hd' })}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
              >
                <option value="standard">Standard (faster, cheaper)</option>
                <option value="hd">HD (slower, higher quality)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Size</label>
              <select
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
            <p className="mt-1 text-xs text-zinc-600">Maximum automatic review iterations when auto-review is enabled. Manual user revisions remain separate.</p>
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

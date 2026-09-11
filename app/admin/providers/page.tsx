'use client';

import { useEffect, useState } from 'react';
import { useNotifications } from '@/components/Notifications';
import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  testProvider,
  type AdminProvider,
} from '@/lib/admin-api';

const PRESETS: Partial<AdminProvider>[] = [
  { name: 'PesatRouter', baseUrl: 'https://api.pesatrouter.com/v1', textModel: 'pesat-pro', imageModel: '' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', textModel: 'gpt-4o', imageModel: 'dall-e-3' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', textModel: 'openai/gpt-4o', imageModel: 'openai/dall-e-3' },
  { name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', textModel: 'meta-llama/Llama-3-70b-chat-hf', imageModel: 'stabilityai/stable-diffusion-xl' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', textModel: 'llama3-70b-8192', imageModel: '' },
  { name: 'Custom', baseUrl: '', textModel: '', imageModel: '' },
];

export default function ProvidersPage() {
  const { confirm, notify } = useNotifications();
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<AdminProvider>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = async () => {
    try {
      const data = await listProviders();
      setProviders(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    listProviders()
      .then(setProviders)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Failed to load providers'))
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = (preset?: Partial<AdminProvider>) => {
    const newProvider: Partial<AdminProvider> = {
      name: preset?.name || '',
      baseUrl: preset?.baseUrl || '',
      textModel: preset?.textModel || '',
      imageModel: preset?.imageModel || '',
      isActive: providers.length === 0,
    };
    setForm(newProvider);
    setEditing('new');
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') {
        await createProvider({
          name: form.name || '',
          baseUrl: form.baseUrl || '',
          textModel: form.textModel || '',
          imageModel: form.imageModel,
          isActive: form.isActive,
        });
      } else if (editing) {
        await updateProvider(editing, {
          name: form.name,
          baseUrl: form.baseUrl,
          textModel: form.textModel,
          imageModel: form.imageModel,
          isActive: form.isActive,
        });
      }
      await loadProviders();
      setEditing(null);
      setForm({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm({ title: 'Delete API provider?', message: 'This provider configuration will be permanently removed.', confirmLabel: 'Delete provider', tone: 'danger' })) return;
    try {
      await deleteProvider(id);
      await loadProviders();
      if (editing === id) setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const handleSetActive = async (id: string) => {
    try {
      await updateProvider(id, { isActive: true });
      await loadProviders();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set active');
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    try {
      await testProvider({ baseUrl: form.baseUrl || '', textModel: form.textModel || '' });
      notify('Connection successful. The provider accepted a chat completion request.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="admin-page admin-enter space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">API Providers</h1>
          <p className="mt-1 text-sm text-zinc-400">Configure OpenAI-compatible API providers</p>
        </div>
        <div className="flex gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => handleAdd(preset)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
            >
              + {preset.name}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {editing === 'new' && (
        <div className="space-y-4 rounded-xl border border-blue-500/30 bg-white/5 p-5">
          <h2 className="text-sm font-semibold text-white">Add provider</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-zinc-400">Name<input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" /></label>
            <label className="text-xs text-zinc-400">Base URL<input value={form.baseUrl || ''} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" /></label>
            <label className="text-xs text-zinc-400">Text model<input value={form.textModel || ''} onChange={(e) => setForm({ ...form, textModel: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" /></label>
            <label className="text-xs text-zinc-400">Image model (optional)<input value={form.imageModel || ''} onChange={(e) => setForm({ ...form, imageModel: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" /></label>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-xs leading-5 text-zinc-400">This provider uses the server-side <code>OPENAI_API_KEY</code> Cloudflare secret. Provider keys are never entered or exposed in this page.</div>
          <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={Boolean(form.isActive)} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Make active after saving</label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleTest} disabled={testing || !form.baseUrl || !form.textModel} className="rounded-lg border border-blue-500/40 px-4 py-2 text-sm font-semibold text-blue-300 disabled:opacity-50">{testing ? 'Testing...' : 'Test connection'}</button>
            <button onClick={handleSave} disabled={saving || !form.name || !form.baseUrl || !form.textModel} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save provider'}</button>
            <button onClick={() => { setEditing(null); setForm({}); }} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-400">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-sm text-zinc-500">Loading providers...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className={`rounded-xl border bg-white/5 overflow-hidden transition-colors ${
                provider.isActive ? 'border-blue-500/30' : 'border-white/10'
              }`}
            >
              {editing === provider.id ? (
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-400">Name</label>
                      <input
                        type="text"
                        value={form.name || ''}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-400">Base URL</label>
                      <input
                        type="text"
                        value={form.baseUrl || ''}
                        onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                        placeholder="https://api.openai.com/v1"
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border border-black/10 bg-black/[0.04] px-4 py-3 text-xs text-black/55">
                    Provider credentials are managed securely through the Cloudflare <code>OPENAI_API_KEY</code> secret and are never exposed here.
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-400">Text Model</label>
                      <input
                        type="text"
                        value={form.textModel || ''}
                        onChange={(e) => setForm({ ...form, textModel: e.target.value })}
                        placeholder="gpt-4o"
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-400">Image Model</label>
                      <input
                        type="text"
                        value={form.imageModel || ''}
                        onChange={(e) => setForm({ ...form, imageModel: e.target.value })}
                        placeholder="dall-e-3"
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleTest}
                      disabled={testing || !form.baseUrl || !form.textModel}
                      className="rounded-lg border border-blue-500/40 px-4 py-2 text-sm font-semibold text-blue-300 disabled:opacity-50"
                    >
                      {testing ? 'Testing...' : 'Test connection'}
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditing(null); setForm({}); }}
                      className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${provider.isActive ? 'bg-green-500' : 'bg-zinc-600'}`} />
                    <div>
                      <p className="text-sm font-medium text-white">{provider.name}</p>
                      <p className="text-xs text-zinc-500">{provider.textModel} · {provider.imageModel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!provider.isActive && (
                      <button
                        onClick={() => handleSetActive(provider.id)}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
                      >
                        Set Active
                      </button>
                    )}
                    <button
                      onClick={() => { setEditing(provider.id); setForm(provider); }}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(provider.id)}
                      className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {providers.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
              <p className="text-sm text-zinc-500">No API providers configured yet.</p>
              <p className="mt-1 text-xs leading-5 text-zinc-600">The built-in environment provider may still power generation when <code>OPENAI_API_KEY</code> is configured. Add a provider here only to override its URL or models.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

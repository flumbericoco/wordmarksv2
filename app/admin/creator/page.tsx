'use client';

import { useEffect, useRef, useState } from 'react';
import { createKBItem, deleteKBItem, getSettings, listKBItems, updateSettings, type AdminKBItem, type AdminSettings } from '@/lib/admin-api';
import { useNotifications } from '@/components/Notifications';

const EMPTY: AdminSettings = { systemPrompt: '', negativePrompt: '', defaultProviderId: '', maxIterations: 3, imageQuality: 'hd', imageSize: '1024x1024', autoApprove: false, knowledgeBaseEnabled: true };
const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json'];

export default function CreatorPage() {
  const [settings, setSettings] = useState(EMPTY);
  const [items, setItems] = useState<AdminKBItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { notify, confirm } = useNotifications();

  async function refresh() {
    const [nextSettings, nextItems] = await Promise.all([getSettings(), listKBItems()]);
    setSettings(nextSettings); setItems(nextItems);
  }
  useEffect(() => {
    Promise.all([getSettings(), listKBItems()])
      .then(([nextSettings, nextItems]) => { setSettings(nextSettings); setItems(nextItems); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load creator'))
      .finally(() => setBusy(false));
  }, []);

  async function save() {
    setError(''); setSaving(true);
    try { setSettings(await updateSettings(settings)); notify('Logo Creator instructions saved.', 'success'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save'); }
    finally { setSaving(false); }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setError('');
    try {
      for (const file of Array.from(files)) {
        const extension = file.name.split('.').pop()?.toLowerCase() || '';
        const isImage = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
        const isText = file.type.startsWith('text/') || TEXT_EXTENSIONS.includes(extension);
        if ((!isImage && !isText) || file.size > 5_000_000) throw new Error(`${file.name}: unsupported file or larger than 5MB`);
        if (isImage) {
          const imageData = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
          await createKBItem({ filename: file.name, category: 'Logo Reference', imageData });
        } else {
          const content = (await file.text()).trim();
          if (!content) throw new Error(`${file.name}: file is empty`);
          await createKBItem({ filename: file.name, category: 'Brand Guide', description: content.slice(0, 20_000) });
        }
      }
      await refresh(); notify(`${files.length} knowledge file(s) uploaded.`, 'success');
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setUploading(false); if (input.current) input.current.value = ''; }
  }

  async function remove(item: AdminKBItem) {
    if (!await confirm({ title: 'Remove knowledge file?', message: `${item.filename} will no longer guide logo generation.`, confirmLabel: 'Remove', tone: 'danger' })) return;
    await deleteKBItem(item.id); setItems((current) => current.filter((entry) => entry.id !== item.id));
  }

  if (busy) return <p className="text-sm text-black/50">Loading Logo Creator…</p>;
  return <div className="admin-page admin-enter space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.22em] text-[#6447e8]">Custom AI configuration</p><h1 className="mt-2 text-4xl font-black tracking-[-.05em]">Logo Creator</h1><p className="mt-2 text-sm text-black/50">One place for private instructions, model output, and studio knowledge.</p></div><button id="creator-save-button" type="button" onClick={save} disabled={saving} aria-label="Save Logo Creator configuration" className="relative isolate min-w-[286px] rounded-full bg-[#191916] px-6 py-3 text-xs font-black uppercase tracking-wide disabled:cursor-wait disabled:opacity-70"><span className="relative z-10 text-white">{saving ? 'Saving configuration…' : 'Save configuration'}</span></button></div>
    {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error}</div>}
    <section className="rounded-[28px] border border-black/10 bg-white/70 p-6 sm:p-8"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-black">Instructions</h2><p className="text-xs text-black/45">Private system prompt prepended to every request.</p></div><span className="rounded-full bg-[#d9d3ff] px-3 py-1 text-[10px] font-black">PRIVATE</span></div><textarea value={settings.systemPrompt} onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })} maxLength={20000} rows={14} className="w-full resize-y rounded-2xl border border-black/10 bg-[#f5f3ed] p-5 font-mono text-sm leading-6 outline-none focus:border-[#6447e8]" placeholder="You are a world-class identity designer…"/><p className="mt-2 text-right text-[10px] text-black/35">{settings.systemPrompt.length.toLocaleString()} / 20,000</p><label className="mt-5 block text-xs font-black uppercase tracking-wider">What the model must avoid</label><textarea value={settings.negativePrompt} onChange={(e) => setSettings({ ...settings, negativePrompt: e.target.value })} maxLength={5000} rows={4} className="mt-2 w-full rounded-2xl border border-black/10 bg-[#f5f3ed] p-4 text-sm leading-6 outline-none focus:border-[#6447e8]" /></section>
    <section className="rounded-[28px] border border-black/10 bg-white/70 p-6 sm:p-8"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">Knowledge</h2><p className="text-xs text-black/45">TXT, MD, CSV, JSON, PNG, JPG, or WebP. Text content is injected into the generation context.</p></div><label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={settings.knowledgeBaseEnabled} onChange={(e) => setSettings({ ...settings, knowledgeBaseEnabled: e.target.checked })}/> Use knowledge</label></div><button onClick={() => input.current?.click()} disabled={uploading} className="mt-6 grid min-h-28 w-full place-items-center rounded-2xl border-2 border-dashed border-black/15 bg-[#f5f3ed] text-sm font-bold transition hover:border-[#6447e8] disabled:opacity-50">{uploading ? 'Uploading…' : '+ Upload knowledge files'}</button><input ref={input} className="hidden" type="file" multiple accept="image/png,image/jpeg,image/webp,.txt,.md,.markdown,.csv,.json" onChange={(e) => void upload(e.target.files)}/><div className="mt-5 divide-y divide-black/10">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{item.filename}</p><p className="text-[11px] text-black/40">{item.kind === 'image' ? 'Visual reference' : 'Knowledge document'} · {item.category}</p></div><button onClick={() => void remove(item)} className="text-xs font-bold text-red-600">Remove</button></div>)}{!items.length && <p className="py-8 text-center text-sm text-black/35">No knowledge files yet.</p>}</div></section>
    <section className="grid gap-4 rounded-[28px] border border-black/10 bg-white/70 p-6 sm:grid-cols-3 sm:p-8"><label className="text-xs font-bold">Quality<select value={settings.imageQuality} onChange={(e) => setSettings({ ...settings, imageQuality: e.target.value as AdminSettings['imageQuality'] })} className="mt-2 w-full rounded-xl border border-black/10 bg-[#f5f3ed] p-3"><option value="hd">HD</option><option value="standard">Standard</option></select></label><label className="text-xs font-bold">Canvas<select value={settings.imageSize} onChange={(e) => setSettings({ ...settings, imageSize: e.target.value as AdminSettings['imageSize'] })} className="mt-2 w-full rounded-xl border border-black/10 bg-[#f5f3ed] p-3"><option value="1024x1024">Square</option><option value="1792x1024">Landscape</option><option value="1024x1792">Portrait</option></select></label><div className="rounded-xl bg-[#191916] p-4 text-xs leading-5 text-white/60"><strong className="block text-white">Image-first pipeline</strong>Generation now requests a real raster image. SVG is only used when explicitly selected as the image model.</div></section>
  </div>;
}

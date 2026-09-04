'use client';

import { useEffect, useState, useRef } from 'react';
import {
  listKBItems,
  createKBItem,
  updateKBItem,
  deleteKBItem,
  type AdminKBItem,
} from '@/lib/admin-api';

const CATEGORIES = ['Logo Reference', 'Style Guide', 'Typography', 'Color Palette', 'Industry Example', 'Other'];

export default function KnowledgeBasePage() {
  const [items, setItems] = useState<AdminKBItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadItems = async (category?: string) => {
    try {
      const data = await listKBItems(category);
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    listKBItems()
      .then(setItems)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Failed to load items'))
      .finally(() => setLoading(false));
  }, []);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    setError(null);

    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;

        // Convert to base64 for server upload
        const imageData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        await createKBItem({
          filename: file.name,
          category: 'Logo Reference',
          imageData,
        });
      }
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteKBItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const handleUpdate = async (id: string, updates: Partial<AdminKBItem>) => {
    try {
      await updateKBItem(id, updates);
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...updates } : i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const filtered = filterCategory === 'all' ? items : items.filter((i) => i.category === filterCategory);

  return (
    <div className="admin-page admin-enter space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Knowledge Base</h1>
          <p className="mt-1 text-sm text-zinc-400">Upload reference logos for the AI to study</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : '+ Upload Images'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Category Filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => { setFilterCategory('all'); loadItems(); }}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            filterCategory === 'all' ? 'bg-blue-600 text-white' : 'bg-white/5 text-zinc-500 hover:bg-white/10'
          }`}
        >
          All ({items.length})
        </button>
        {CATEGORIES.map((cat) => {
          const count = items.filter((i) => i.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => { setFilterCategory(cat); loadItems(cat); }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filterCategory === cat ? 'bg-blue-600 text-white' : 'bg-white/5 text-zinc-500 hover:bg-white/10'
              }`}
            >
              {cat} ({count})
            </button>
          );
        })}
      </div>

      {/* Upload Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer rounded-xl border-2 border-dashed border-white/10 bg-white/5 p-6 text-center transition-colors hover:border-white/20 hover:bg-white/10"
      >
        <p className="text-sm text-zinc-400">
          Drag & drop images here, or <span className="text-blue-400">click to browse</span>
        </p>
        <p className="mt-1 text-xs text-zinc-600">PNG, JPG, SVG — logos you like, style references, etc.</p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-sm text-zinc-500">Loading...</p>
        </div>
      ) : (
        /* Items Grid */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <div key={item.id} className="group rounded-xl border border-white/10 bg-white/5 overflow-hidden">
              <div className="relative">
                {item.imageUrl || item.imageData ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.imageData || item.imageUrl || ''}
                    alt={item.filename}
                    className="h-40 w-full object-cover"
                  />
                ) : (
                  <div className="h-40 w-full flex items-center justify-center bg-white/5 text-zinc-600">
                    No preview
                  </div>
                )}
                <button
                  onClick={() => handleDelete(item.id)}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  X
                </button>
              </div>
              <div className="p-3 space-y-2">
                <p className="text-xs font-medium text-white truncate">{item.filename}</p>
                <select
                  value={item.category}
                  onChange={(e) => handleUpdate(item.id, { category: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-400 outline-none"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={item.description}
                  onChange={(e) => handleUpdate(item.id, { description: e.target.value })}
                  placeholder="Add a note..."
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-400 placeholder-zinc-600 outline-none"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-sm text-zinc-500">
            {filterCategory === 'all'
              ? 'No reference images uploaded yet.'
              : `No images in "${filterCategory}" category.`}
          </p>
        </div>
      )}
    </div>
  );
}

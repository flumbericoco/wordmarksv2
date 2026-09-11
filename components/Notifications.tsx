'use client';

import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';

type Tone = 'default' | 'danger' | 'success';
type ConfirmOptions = { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; tone?: Tone };
type NotificationApi = { confirm: (options: ConfirmOptions | string) => Promise<boolean>; notify: (message: string, tone?: Tone) => void };
type Dialog = ConfirmOptions & { resolve: (value: boolean) => void };

const NotificationContext = createContext<NotificationApi | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; tone: Tone }>>([]);
  const nextId = useRef(0);

  const confirm = useCallback((options: ConfirmOptions | string) => new Promise<boolean>((resolve) => {
    setDialog({ title: 'Please confirm', confirmLabel: 'Continue', cancelLabel: 'Cancel', tone: 'default', ...(typeof options === 'string' ? { message: options } : options), resolve });
  }), []);
  const notify = useCallback((message: string, tone: Tone = 'default') => {
    const id = ++nextId.current;
    setToasts((items) => [...items, { id, message, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4500);
  }, []);
  const answer = (value: boolean) => { dialog?.resolve(value); setDialog(null); };

  return <NotificationContext.Provider value={{ confirm, notify }}>
    {children}
    <div aria-live="polite" className="fixed right-4 top-4 z-[10000] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
      {toasts.map((toast) => <div key={toast.id} className={`rounded-2xl border px-5 py-4 text-sm font-semibold shadow-2xl backdrop-blur-xl ${toast.tone === 'success' ? 'border-emerald-400/30 bg-emerald-950/95 text-emerald-50' : toast.tone === 'danger' ? 'border-red-400/30 bg-red-950/95 text-red-50' : 'border-white/15 bg-[#171714]/95 text-white'}`}><div className="flex items-start justify-between gap-4"><span>{toast.message}</span><button aria-label="Close notification" onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))} className="text-lg leading-none opacity-60 hover:opacity-100">×</button></div></div>)}
    </div>
    {dialog ? <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) answer(false); }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="notice-title" aria-describedby="notice-message" className="w-full max-w-md overflow-hidden rounded-[2rem] border border-white/15 bg-[#f4f1e9] text-[#171714] shadow-[0_30px_100px_rgba(0,0,0,.55)]">
        <div className={`h-2 ${dialog.tone === 'danger' ? 'bg-red-500' : 'bg-[#6b50ff]'}`} />
        <div className="p-7 sm:p-8"><div className={`mb-5 grid h-11 w-11 place-items-center rounded-full text-xl font-black ${dialog.tone === 'danger' ? 'bg-red-100 text-red-700' : 'bg-[#ded7ff] text-[#5b42d5]'}`}>{dialog.tone === 'danger' ? '!' : '✓'}</div><h2 id="notice-title" className="text-2xl font-black tracking-[-0.04em]">{dialog.title}</h2><p id="notice-message" className="mt-3 whitespace-pre-line text-sm leading-6 text-black/60">{dialog.message}</p><div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button autoFocus onClick={() => answer(false)} className="rounded-full border border-black/15 px-5 py-3 text-sm font-bold hover:bg-black/5">{dialog.cancelLabel}</button><button onClick={() => answer(true)} className={`rounded-full px-5 py-3 text-sm font-black text-white ${dialog.tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#171714] hover:bg-black'}`}>{dialog.confirmLabel}</button></div></div>
      </section>
    </div> : null}
  </NotificationContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error('NotificationsProvider is missing');
  return value;
}

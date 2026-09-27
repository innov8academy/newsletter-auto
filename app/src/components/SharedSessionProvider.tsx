'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SharedSessionClient, type SharedSessionSnapshot } from '@/lib/shared-session-client';

const Context = createContext<{
  client: SharedSessionClient;
  snapshot: SharedSessionSnapshot;
} | null>(null);

export function useSharedSession() {
  const value = useContext(Context);
  if (!value) throw new Error('SharedSessionProvider is required.');
  return value;
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SharedSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [client] = useState(() => new SharedSessionClient());
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const workflow = pathname === '/' || pathname === '/research' || pathname === '/draft' || pathname?.startsWith('/draft/');
  const sessionSurface = workflow || pathname === '/studio';

  useEffect(() => {
    if (!workflow && pathname !== '/studio') return;
    void client.load();
    const onFocus = () => void client.load();
    const onVisible = () => { if (document.visibilityState === 'visible') void client.load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void client.load();
    }, 15000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, [client, workflow, pathname]);

  const blocked = workflow && !snapshot.state;
  const conflict = snapshot.phase === 'conflict';
  const issue = ['load_error', 'save_error', 'auth', 'conflict'].includes(snapshot.phase);
  return (
    <Context.Provider value={{ client, snapshot }}>
      {blocked ? (
        <main className="min-h-screen flex items-center justify-center bg-[#0B0B0F] px-6 text-white">
          <section className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
            <h1 className="font-display text-2xl">Shared newsletter</h1>
            <p className="mt-3 text-sm text-white/65">
              {snapshot.phase === 'loading' ? 'Loading the latest newsletter...' : snapshot.message}
            </p>
            {snapshot.phase !== 'loading' && (
              <div className="mt-6 flex justify-center gap-3">
                <button onClick={() => void client.retry()} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black">Retry</button>
                {snapshot.phase === 'auth' && <a href="/login" className="rounded-lg border border-white/20 px-4 py-2 text-sm">Sign in</a>}
              </div>
            )}
            <p className="mt-5 text-xs text-white/40">Your local work remains on this device while the shared session is unavailable.</p>
          </section>
        </main>
      ) : children}

      {workflow && snapshot.state && (
        <div className="fixed bottom-4 right-4 z-[150] rounded-full border border-white/15 bg-[#17171e]/95 px-3 py-1.5 text-xs text-white/70 shadow-xl backdrop-blur" role="status" aria-live="polite">
          {snapshot.phase === 'ready' ? 'Saved to shared newsletter' :
            snapshot.phase === 'saving' ? 'Saving to shared newsletter...' :
            snapshot.phase === 'auth' ? 'Sign in to save' :
            conflict ? 'Shared newsletter changed' : 'Changes saved on this device only'}
        </div>
      )}

      {sessionSurface && snapshot.state && (issue || snapshot.legacyAvailable) && (
        <div className="fixed top-3 left-1/2 z-[160] w-[min(95vw,800px)] -translate-x-1/2 rounded-xl border border-amber-400/30 bg-[#251e14]/95 p-4 text-sm text-amber-50 shadow-2xl backdrop-blur" role="alert">
          {issue ? <p>{snapshot.message}</p> : <p>Older local work was saved on this browser. {snapshot.legacyReports > 0 || snapshot.legacyDraft ? `You can import matching research${snapshot.legacyDraft ? ' and draft progress' : ''}.` : 'Download the backup if you need it.'}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {snapshot.phase === 'save_error' || snapshot.phase === 'auth' ?
              <button onClick={() => void client.retry()} className="rounded-md bg-amber-400 px-3 py-1.5 font-medium text-black">Retry save</button> : null}
            {snapshot.phase === 'auth' && <a href="/login" className="rounded-md border border-white/30 px-3 py-1.5">Sign in</a>}
            {conflict && <>
              <button onClick={() => client.useLatest()} className="rounded-md bg-amber-400 px-3 py-1.5 font-medium text-black">Load latest shared work</button>
              {snapshot.latest?.sessionId === snapshot.state.sessionId &&
                <button onClick={() => {
                  if (window.confirm('Replace the newer shared changes with this device\'s copy?')) client.replaceShared();
                }} className="rounded-md border border-white/30 px-3 py-1.5">Replace shared with my copy</button>}
              {client.pendingCopy() && <button onClick={() => download('newsletter-unsaved-copy.json', client.pendingCopy()!)} className="rounded-md border border-white/30 px-3 py-1.5">Download my copy</button>}
            </>}
            {!issue && (snapshot.legacyReports > 0 || snapshot.legacyDraft) &&
              <button onClick={() => client.importLegacy()} className="rounded-md bg-amber-400 px-3 py-1.5 font-medium text-black">Import matching work</button>}
            {client.legacyBackup() && <button onClick={() => download('newsletter-older-local-work.json', client.legacyBackup()!)} className="rounded-md border border-white/30 px-3 py-1.5">Download older work</button>}
            {!issue && snapshot.legacyAvailable && <button onClick={() => client.dismissLegacy()} className="rounded-md border border-white/30 px-3 py-1.5">Dismiss</button>}
          </div>
        </div>
      )}
    </Context.Provider>
  );
}

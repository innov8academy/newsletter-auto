'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
  const [history, setHistory] = useState<Array<{ id: string; source: string; created_at: string }> | null>(null);
  const [historyError, setHistoryError] = useState('');
  async function openHistory() {
    try { const response = await fetch('/api/newsletter/versions', { cache: 'no-store' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setHistory(data.versions); setHistoryError('');
    } catch { setHistoryError('Cloud history could not load. Retry when connected.'); }
  }
  const [client] = useState(() => new SharedSessionClient());
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const workflow = pathname === '/' || pathname === '/research' || pathname === '/draft' || (pathname?.startsWith('/draft/') && pathname !== '/draft/meme-editor');
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
    }, 3000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, [client, workflow, pathname]);

  const choices = snapshot.state?.draftChoices ?? [];
  const blocked = sessionSurface && (!snapshot.state || choices.length > 0 || Boolean(snapshot.state.resolveVersion));
  const conflict = snapshot.phase === 'conflict';
  const issue = ['load_error', 'save_error', 'auth', 'conflict'].includes(snapshot.phase);
  return (
    <Context.Provider value={{ client, snapshot }}>
      {blocked ? (
        <main className="min-h-screen flex items-center justify-center bg-[#0B0B0F] px-6 text-white">
          <section className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
            <h1 className="font-display text-2xl">Current newsletter</h1>
            <p className="mt-3 text-sm text-white/65">
              {choices.length ? 'Two saved draft versions were preserved. Review each copy, then choose the version to continue. Both remain in cloud history. Any pending browser copy is kept on this device.' : snapshot.phase === 'loading' ? 'Loading the latest newsletter...' : snapshot.message}
            </p>
            {choices.length > 0 && <div className="mt-5 space-y-3">{choices.map(choice => <div key={choice.id} className="rounded-lg border border-white/20 p-3">
              <p>{choice.source} · {new Date(choice.updatedAt).toLocaleString()}</p>
              <a href={'/api/newsletter/versions/' + choice.id} target="_blank" rel="noopener noreferrer" className="mr-4 underline">Review saved copy</a>
              <button onClick={() => { if (window.confirm('Continue with ' + choice.source + '? Both versions remain in cloud history.')) { client.resolveDraftChoice(choice.id); } }} className="mt-2 rounded bg-amber-400 px-3 py-2 text-black">Continue with this version</button>
            </div>)}</div>}
            {choices.length > 0 && client.pendingCopy() && <button onClick={() => download('newsletter-unsaved-copy.json', client.pendingCopy()!)} className="mt-4 text-sm underline">Download my local copy</button>}
            {!choices.length && snapshot.phase !== 'loading' && (
              <div className="mt-6 flex justify-center gap-3">
                <button onClick={() => void client.retry()} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black">Retry</button>
                {snapshot.phase === 'auth' && <a target="_blank" rel="noopener noreferrer" href="/login" className="rounded-lg border border-white/20 px-4 py-2 text-sm">Sign in</a>}
              </div>
            )}
            <p className="mt-5 text-xs text-white/40">Your local work remains on this device while the cloud save is unavailable.</p>
          </section>
        </main>
      ) : children}

      {workflow && snapshot.state && (
        <div className="fixed bottom-4 right-4 z-[150] rounded-full border border-white/15 bg-[#17171e]/95 px-3 py-1.5 text-xs text-white/70 shadow-xl backdrop-blur" role="status" aria-live="polite">
          {snapshot.phase === 'ready' ? 'Saved to cloud' :
            snapshot.phase === 'saving' ? 'Saving to cloud...' :
            snapshot.phase === 'auth' ? 'Sign in to save' :
            conflict ? 'Newsletter changed elsewhere' : 'Changes saved on this device only'}
          <button onClick={() => void openHistory()} className="ml-3 underline">History</button>
        </div>
      )}

      <Dialog open={Boolean(history || historyError)} onOpenChange={open => { if (!open) { setHistory(null); setHistoryError(''); } }}><DialogContent className="z-[180] max-h-[80vh] overflow-y-auto border-white/20 bg-[#17171e] text-white">

          <div className="flex justify-between gap-4"><DialogTitle>Cloud version history</DialogTitle><button onClick={() => { setHistory(null); setHistoryError(''); }}>Close</button></div>
          <DialogDescription>Review a copy before restoring. Restoring also preserves the current work.</DialogDescription>
          {historyError && <p role="alert">{historyError}</p>}
          {history?.map(version => <div className="mt-4 border-t border-white/10 pt-3" key={version.id}>
            <p className="text-sm">{new Date(version.created_at).toLocaleString()} · {version.source}</p>
            <a href={'/api/newsletter/versions/' + version.id} target="_blank" rel="noopener noreferrer" className="mr-4 text-sm underline">Review copy</a>
            {['new-newsletter','workspace-save','legacy-writing'].includes(version.source) && <button className="text-sm text-amber-300" onClick={() => {
              if (window.confirm('Restore this newsletter? Current work will be preserved in cloud history.')) { client.mutate({ resolveVersion: version.id }); void client.flush(); setHistory(null); }
            }}>Restore this version</button>}
          </div>)}
      </DialogContent></Dialog>
      {sessionSurface && snapshot.state && !choices.length && (issue || snapshot.legacyAvailable) && (
        <div className="fixed top-3 left-1/2 z-[160] w-[min(95vw,800px)] -translate-x-1/2 rounded-xl border border-amber-400/30 bg-[#251e14]/95 p-4 text-sm text-amber-50 shadow-2xl backdrop-blur" role="alert">
          {issue ? <p>{snapshot.message}</p> : <p>Older local work was saved on this browser. {snapshot.legacyReports > 0 || snapshot.legacyDraft ? `You can import matching research${snapshot.legacyDraft ? ' and draft progress' : ''}.` : 'Download the backup if you need it.'}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {snapshot.phase === 'save_error' || snapshot.phase === 'auth' ?
              <button onClick={() => void client.retry()} className="rounded-md bg-amber-400 px-3 py-1.5 font-medium text-black">Retry save</button> : null}
            {snapshot.phase === 'auth' && <a target="_blank" rel="noopener noreferrer" href="/login" className="rounded-md border border-white/30 px-3 py-1.5">Sign in</a>}
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

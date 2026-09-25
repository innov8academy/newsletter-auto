'use client';

import { useEffect, useState } from 'react';
import { canUsePersistentStorage } from '@/lib/browser-storage';

export default function BrowserStorageNotice() {
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    setAvailable(canUsePersistentStorage());
  }, []);

  if (available) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-400/20 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-100/90"
    >
      Browser storage is blocked. Local drafts will not be saved across reloads.
      Allow site data for this app, then reload to keep your progress.
    </div>
  );
}

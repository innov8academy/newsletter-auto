type StorageGetter = () => Storage | null;

/**
 * Keep app state usable when a browser blocks local storage or runs out of
 * quota. Values fall back to this tab's memory and are not kept after reload.
 */
export function createSafeStorage(getStorage: StorageGetter): Storage {
  const memory = new Map<string, string>();

  function backingStorage(): Storage | null {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }

  function keys(): string[] {
    const found = new Set(memory.keys());
    const storage = backingStorage();
    if (storage) {
      try {
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (key !== null) found.add(key);
        }
      } catch {
        // Keep the keys available in memory when the backing store is blocked.
      }
    }
    return Array.from(found);
  }

  return {
    get length() {
      return keys().length;
    },
    clear() {
      try {
        backingStorage()?.clear();
      } catch {
        // Clearing the in memory copy is still useful when storage is blocked.
      }
      memory.clear();
    },
    getItem(key) {
      const normalized = String(key);
      if (memory.has(normalized)) return memory.get(normalized) ?? null;
      try {
        return backingStorage()?.getItem(normalized) ?? null;
      } catch {
        return null;
      }
    },
    key(index) {
      return keys()[index] ?? null;
    },
    removeItem(key) {
      const normalized = String(key);
      memory.delete(normalized);
      try {
        backingStorage()?.removeItem(normalized);
      } catch {
        // Ignore inaccessible storage and keep the rest of the app running.
      }
    },
    setItem(key, value) {
      const normalized = String(key);
      const serialized = String(value);
      try {
        const storage = backingStorage();
        if (!storage) throw new Error('Browser storage is unavailable.');
        storage.setItem(normalized, serialized);
        memory.delete(normalized);
      } catch {
        memory.set(normalized, serialized);
      }
    },
  };
}

export const browserStorage = createSafeStorage(() => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
});

export function canUsePersistentStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const storage = window.localStorage;
    const key = `__innov8_storage_probe_${Date.now()}_${Math.random()}`;
    storage.setItem(key, '1');
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

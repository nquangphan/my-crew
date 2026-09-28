import { useCallback, useEffect, useSyncExternalStore } from 'react';

/** Tailwind breakpoints used by the layout: phone < md (768) ≤ tablet < xl (1280) ≤ desktop. */
export type Viewport = 'phone' | 'tablet' | 'desktop';

function readViewport(): Viewport {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  if (window.matchMedia('(min-width: 1280px)').matches) return 'desktop';
  if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
  return 'phone';
}

function subscribeViewport(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const queries = ['(min-width: 1280px)', '(min-width: 768px)'].map((q) => window.matchMedia(q));
  for (const query of queries) query.addEventListener('change', callback);
  return () => {
    for (const query of queries) query.removeEventListener('change', callback);
  };
}

export function useViewport(): Viewport {
  return useSyncExternalStore(subscribeViewport, readViewport, () => 'desktop');
}

const storageListeners = new Set<() => void>();
const notifyStorage = () => {
  for (const listener of storageListeners) listener();
};
if (typeof window !== 'undefined') window.addEventListener('storage', notifyStorage);

function subscribeStorage(listener: () => void): () => void {
  storageListeners.add(listener);
  return () => storageListeners.delete(listener);
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A value persisted in localStorage (UI preferences only; never secrets). Every component using the same
 * key sees the same value, including across tabs.
 */
export function useStoredState<T>(key: string, initial: T): [T, (value: T) => void] {
  const raw = useSyncExternalStore(
    subscribeStorage,
    () => readStored(key),
    () => null,
  );
  let value = initial;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = initial;
    }
  }
  const set = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage full or disabled: the preference just is not remembered
      }
      notifyStorage();
    },
    [key],
  );
  return [value, set];
}

export type Theme = 'light' | 'dark';
const THEME_KEY = 'crew.theme';

export function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === '"dark"' || stored === '"light"') return JSON.parse(stored) as Theme;
  } catch {
    // fall through
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useStoredState<Theme>(THEME_KEY, initialTheme());
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  return [theme, setTheme];
}

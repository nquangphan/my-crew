import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';

type ToastTone = 'info' | 'error' | 'success';
interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
}

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => {});

/** Lightweight toaster: errors and confirmations of background actions (drag, bulk edits). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-3), { id, tone, text }]);
    setTimeout(() => setItems((list) => list.filter((item) => item.id !== id)), 6_000);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-center gap-2 md:right-4 md:left-auto md:items-end">
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto max-w-md rounded-md border px-4 py-3 text-sm shadow-lg',
              item.tone === 'error' && 'border-bad bg-bad-bg text-bad-ink',
              item.tone === 'success' && 'border-ok bg-ok-bg text-ok-ink',
              item.tone === 'info' && 'border-line bg-panel text-ink',
            )}
          >
            {item.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

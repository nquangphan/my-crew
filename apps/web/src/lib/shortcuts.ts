import { useEffect, useRef } from 'react';

/** Keyboard shortcuts are a desktop feature (≥ 1280 px, the `xl` breakpoint). */
export const DESKTOP_QUERY = '(min-width: 1280px)';

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(DESKTOP_QUERY).matches === true;
}

/** True when the key press belongs to a text field, a menu or a dialog control, not to the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.closest('[role="menu"],[role="listbox"],[role="combobox"]') !== null;
}

/** Shortcut ids: single keys (`c`, `/`, `?`, `j`, `k`, `Escape`) and `g`-sequences (`g b`). */
export type ShortcutMap = Partial<Record<string, (event: KeyboardEvent) => void>>;

export const SHORTCUT_HELP: readonly { keys: string; label: string }[] = [
  { keys: '/', label: 'Tìm kiếm' },
  { keys: 'c', label: 'Tạo ticket' },
  { keys: 'g a', label: 'Tới board Tất cả dự án' },
  { keys: 'g b', label: 'Tới Board' },
  { keys: 'g l', label: 'Tới Danh sách' },
  { keys: 'g d', label: 'Tới Docs (dự án đang mở, nếu không thì trang Tài liệu)' },
  { keys: 'g i', label: 'Tới Inbox' },
  { keys: 'j / k', label: 'Card hoặc dòng tiếp theo / trước' },
  { keys: 'Enter', label: 'Mở ticket đang chọn' },
  { keys: 'Esc', label: 'Đóng panel' },
  { keys: '?', label: 'Bảng phím tắt' },
];

const SEQUENCE_TIMEOUT_MS = 1_000;

/**
 * Resolves a key press against the map, tracking a pending `g` prefix. Exported for tests.
 * Returns the shortcut id that fired, or null.
 */
export function matchShortcut(
  key: string,
  pendingPrefix: string | null,
  map: ShortcutMap,
): { id: string | null; prefix: string | null } {
  if (pendingPrefix) {
    const id = `${pendingPrefix} ${key}`;
    return { id: map[id] ? id : null, prefix: null };
  }
  if (key === 'g' && Object.keys(map).some((id) => id.startsWith('g '))) return { id: null, prefix: 'g' };
  return { id: map[key] ? key : null, prefix: null };
}

/**
 * Registers page-level shortcuts. Ignored while typing, with modifier keys, below the desktop breakpoint,
 * and (except Escape) while a modal dialog is open.
 */
export function useShortcuts(map: ShortcutMap, enabled = true): void {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!enabled) return;
    let prefix: string | null = null;
    let prefixTimer: ReturnType<typeof setTimeout> | undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!isDesktop()) return;
      if (event.key !== 'Escape' && isTypingTarget(event.target)) return;
      if (event.key !== 'Escape' && document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const result = matchShortcut(event.key, prefix, mapRef.current);
      clearTimeout(prefixTimer);
      prefix = result.prefix;
      if (prefix) prefixTimer = setTimeout(() => (prefix = null), SEQUENCE_TIMEOUT_MS);
      if (result.id) {
        event.preventDefault();
        mapRef.current[result.id]?.(event);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(prefixTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);
}

/** Next index for `j`/`k` over a list of `count` items; -1 means nothing is selected yet. */
export function stepIndex(current: number, count: number, delta: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + delta));
}

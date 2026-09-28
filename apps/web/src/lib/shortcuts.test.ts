import { describe, expect, it, vi } from 'vitest';
import { isTypingTarget, matchShortcut, stepIndex } from './shortcuts';

describe('shortcuts', () => {
  const map = { c: vi.fn(), '/': vi.fn(), 'g b': vi.fn(), 'g i': vi.fn() };

  it('matches single keys and g-sequences', () => {
    expect(matchShortcut('c', null, map)).toEqual({ id: 'c', prefix: null });
    expect(matchShortcut('g', null, map)).toEqual({ id: null, prefix: 'g' });
    expect(matchShortcut('b', 'g', map)).toEqual({ id: 'g b', prefix: null });
    expect(matchShortcut('x', 'g', map)).toEqual({ id: null, prefix: null });
    expect(matchShortcut('b', null, map)).toEqual({ id: null, prefix: null });
    expect(matchShortcut('g', null, { j: vi.fn() })).toEqual({ id: null, prefix: null });
  });

  it('ignores key presses inside text fields', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
  });

  it('steps j/k within bounds', () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
    expect(stepIndex(2, 3, 1)).toBe(2);
    expect(stepIndex(0, 3, -1)).toBe(0);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

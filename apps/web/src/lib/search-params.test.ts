import { describe, expect, it } from 'vitest';
import {
  BoardSearch,
  ListSearch,
  parseStatuses,
  parseTypes,
  safeRedirect,
  searchOf,
  toggleCsv,
} from './search-params';

describe('URL filters', () => {
  it('parses CSV filters and drops unknown values', () => {
    expect(parseTypes('dev,qc,nope')).toEqual(['dev', 'qc']);
    expect(parseStatuses(undefined)).toEqual([]);
  });

  it('toggles a CSV value and removes the parameter when empty', () => {
    expect(toggleCsv(undefined, 'dev')).toBe('dev');
    expect(toggleCsv('dev', 'qc')).toBe('dev,qc');
    expect(toggleCsv('dev', 'dev')).toBeUndefined();
  });

  it('falls back instead of throwing on bad search params', () => {
    expect(searchOf(ListSearch)({ sort: 'evil', order: 'up', q: 'x' })).toEqual({ q: 'x' });
    expect(searchOf(BoardSearch)({ selected: 'SHOP-1', mine: 'yes' })).toEqual({ selected: 'SHOP-1' });
  });

  it('only follows same-site login redirects', () => {
    expect(safeRedirect('/projects/SHOP/board?selected=SHOP-2')).toBe('/projects/SHOP/board?selected=SHOP-2');
    expect(safeRedirect('https://evil.example')).toBe('/');
    expect(safeRedirect('//evil.example')).toBe('/');
    expect(safeRedirect('/\\evil.example')).toBe('/');
    expect(safeRedirect('/login?redirect=/x')).toBe('/');
    expect(safeRedirect(undefined)).toBe('/');
  });
});

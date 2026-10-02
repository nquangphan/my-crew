export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const serialize = (current: unknown): string => {
    if (current === null) return 'null';
    if (typeof current === 'string' || typeof current === 'boolean') return JSON.stringify(current);
    if (typeof current === 'number' && Number.isFinite(current)) return JSON.stringify(current);
    if (typeof current !== 'object') throw new Error('JSON_CANONICAL_INVALID');
    if (ancestors.has(current)) throw new Error('JSON_CANONICAL_INVALID');
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        return `[${Array.from(current, (item) => serialize(item)).join(',')}]`;
      }
      const prototype: unknown = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) throw new Error('JSON_CANONICAL_INVALID');
      if (Object.getOwnPropertySymbols(current).length > 0) throw new Error('JSON_CANONICAL_INVALID');
      const fields = Object.keys(current)
        .sort()
        .map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor || !('value' in descriptor)) throw new Error('JSON_CANONICAL_INVALID');
          return `${JSON.stringify(key)}:${serialize(descriptor.value)}`;
        });
      return `{${fields.join(',')}}`;
    } finally {
      ancestors.delete(current);
    }
  };
  return serialize(value);
}

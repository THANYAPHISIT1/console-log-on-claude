const MAX_STRING = 2048;
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_KEYS = 50;

export function safeSerialize(args: unknown[]): unknown[] {
  const seen = new WeakSet<object>();
  return args.map((a) => walk(a, 0, seen));
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;

  if (t === 'string') {
    const s = value as string;
    return s.length > MAX_STRING ? s.slice(0, MAX_STRING) + `…[+${s.length - MAX_STRING}]` : s;
  }
  if (t === 'number' || t === 'boolean' || t === 'bigint') {
    return t === 'bigint' ? `${value}n` : value;
  }
  if (t === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`;
  if (t === 'symbol') return (value as symbol).toString();

  if (value instanceof Error) {
    return {
      __type: 'Error',
      name: value.name,
      message: value.message,
      stack: value.stack?.split('\n').slice(0, 6).join('\n'),
    };
  }

  if (value instanceof Date) return { __type: 'Date', iso: value.toISOString() };
  if (value instanceof RegExp) return { __type: 'RegExp', source: value.toString() };

  if (depth >= MAX_DEPTH) return '[…max-depth]';

  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => walk(v, depth + 1, seen));
    if (value.length > MAX_ARRAY) out.push(`…[+${value.length - MAX_ARRAY}]`);
    return out;
  }

  try {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    const take = entries.slice(0, MAX_KEYS);
    for (const [k, v] of take) out[k] = walk(v, depth + 1, seen);
    if (entries.length > MAX_KEYS) out['…'] = `+${entries.length - MAX_KEYS} more keys`;
    return out;
  } catch {
    return '[Unserializable]';
  }
}

export function stringifyArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

import type {
  ConsoleEvent,
  ConsoleGroup,
  ConsoleLevel,
  Event,
  Group,
  NetworkEvent,
  NetworkGroup,
  Summary,
} from './types.ts';
import { stringifyArgs } from './serialize.ts';

const CAP_PER_KIND = 100;
const DURATIONS_WINDOW = 50;

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function normalizeConsoleMessage(msg: string): string {
  return msg
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, '<ts>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(url: string): string {
  let u = url;
  try {
    const parsed = new URL(url, 'http://_');
    u = parsed.pathname;
  } catch {
    u = url.split('?')[0] ?? url;
  }
  return u
    .replace(/\/\d+(?=\/|$)/g, '/<n>')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/<uuid>')
    .replace(/\/[0-9a-f]{24,}(?=\/|$)/gi, '/<hash>');
}

function consoleSignature(ev: ConsoleEvent): { sig: string; norm: string } {
  const msg = stringifyArgs(ev.args);
  const norm = normalizeConsoleMessage(msg);
  return { sig: `c:${ev.level}:${fnv1a(norm)}`, norm };
}

function networkSignature(ev: NetworkEvent): { sig: string; urlPattern: string } {
  const urlPattern = normalizeUrl(ev.url);
  return {
    sig: `n:${ev.api}:${ev.method}:${urlPattern}:${ev.status}`,
    urlPattern,
  };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx] ?? 0);
}

export class GroupStore {
  private consoleGroups = new Map<string, ConsoleGroup>();
  private networkGroups = new Map<string, NetworkGroup & { _durations: number[] }>();
  private totals: Summary['totals'] = {
    console: { log: 0, info: 0, warn: 0, error: 0, debug: 0 },
    network: { ok: 0, error: 0 },
  };

  ingest(ev: Event): void {
    if (ev.kind === 'console') this.ingestConsole(ev);
    else this.ingestNetwork(ev);
  }

  private ingestConsole(ev: ConsoleEvent): void {
    this.totals.console[ev.level]++;
    const { sig, norm } = consoleSignature(ev);
    const msg = stringifyArgs(ev.args);
    const existing = this.consoleGroups.get(sig);
    if (existing) {
      existing.count++;
      existing.lastTs = ev.ts;
      existing.latest = msg !== existing.sample ? msg.slice(0, 300) : existing.latest;
      if (ev.url && !existing.urls.includes(ev.url) && existing.urls.length < 5) {
        existing.urls.push(ev.url);
      }
    } else {
      this.consoleGroups.set(sig, {
        kind: 'console',
        signature: sig,
        level: ev.level,
        count: 1,
        firstTs: ev.ts,
        lastTs: ev.ts,
        sample: msg.slice(0, 500),
        stackTop: ev.stackTop,
        urls: ev.url ? [ev.url] : [],
      });
      this.enforceCap('console');
    }
  }

  private ingestNetwork(ev: NetworkEvent): void {
    if (ev.status >= 400 || ev.status === 0 || ev.error) this.totals.network.error++;
    else this.totals.network.ok++;

    const { sig, urlPattern } = networkSignature(ev);
    const existing = this.networkGroups.get(sig);
    if (existing) {
      existing.count++;
      existing.lastTs = ev.ts;
      existing._durations.push(ev.durationMs);
      if (existing._durations.length > DURATIONS_WINDOW) existing._durations.shift();
      existing.p50Ms = percentile(existing._durations, 50);
      existing.p95Ms = percentile(existing._durations, 95);
      if (ev.error) existing.lastError = ev.error;
    } else {
      const durations = [ev.durationMs];
      this.networkGroups.set(sig, {
        kind: 'network',
        signature: sig,
        api: ev.api,
        method: ev.method,
        urlPattern,
        status: ev.status,
        count: 1,
        firstTs: ev.ts,
        lastTs: ev.ts,
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
        lastError: ev.error,
        _durations: durations,
      });
      this.enforceCap('network');
    }
  }

  private enforceCap(kind: 'console' | 'network'): void {
    const store =
      kind === 'console'
        ? (this.consoleGroups as Map<string, Group>)
        : (this.networkGroups as Map<string, Group>);
    if (store.size <= CAP_PER_KIND) return;
    const arr = Array.from(store.entries()).sort(
      ([, a], [, b]) => a.count - b.count || a.lastTs - b.lastTs,
    );
    const toDrop = arr.slice(0, store.size - CAP_PER_KIND);
    for (const [sig] of toDrop) store.delete(sig);
  }

  reset(): void {
    this.consoleGroups.clear();
    this.networkGroups.clear();
    this.totals = {
      console: { log: 0, info: 0, warn: 0, error: 0, debug: 0 },
      network: { ok: 0, error: 0 },
    };
  }

  snapshot(): Summary {
    const levelOrder: Record<ConsoleLevel, number> = {
      error: 0,
      warn: 1,
      info: 2,
      log: 3,
      debug: 4,
    };
    const consoleArr = Array.from(this.consoleGroups.values()).sort(
      (a, b) => levelOrder[a.level] - levelOrder[b.level] || b.count - a.count,
    );
    const networkArr = Array.from(this.networkGroups.values())
      .map(({ _durations, ...rest }) => rest as NetworkGroup)
      .sort((a, b) => {
        const aErr = a.status >= 400 || a.status === 0 ? 0 : 1;
        const bErr = b.status >= 400 || b.status === 0 ? 0 : 1;
        return aErr - bErr || b.count - a.count;
      });

    return {
      generatedAt: Date.now(),
      totals: this.totals,
      console: consoleArr,
      network: networkArr,
    };
  }
}

export class SummaryWriter {
  private timer: Timer | null = null;
  private pending = false;

  constructor(
    private readonly path: string,
    private readonly store: GroupStore,
    private readonly debounceMs = 500,
  ) {}

  schedule(): void {
    this.pending = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending) {
        this.pending = false;
        void this.flush();
      }
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    const snap = this.store.snapshot();
    const tmp = `${this.path}.tmp`;
    await Bun.write(tmp, JSON.stringify(snap, null, 2));
    await Bun.$`mv ${tmp} ${this.path}`.quiet();
  }
}

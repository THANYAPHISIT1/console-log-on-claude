import { mkdir } from 'node:fs/promises';
import type { Event } from './types.ts';
import { GroupStore, SummaryWriter } from './group.ts';
// @ts-expect-error bun file import attribute
import CAPTURE_PATH from '../public/capture.js' with { type: 'file' };

export type ServerOptions = {
  port?: number;
  host?: string;
  dataDir?: string;
  quiet?: boolean;
};

export type ServerHandle = {
  port: number;
  host: string;
  dataDir: string;
  startedAt: number;
  store: GroupStore;
  ring: EventRing;
  clear: () => Promise<void>;
  stop: () => Promise<void>;
};

const RING_CAP = 200;

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

function json(req: Request, body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...corsFor(req), ...(init.headers ?? {}) },
  });
}

function isEvent(v: unknown): v is Event {
  if (!v || typeof v !== 'object') return false;
  const k = (v as { kind?: unknown }).kind;
  return k === 'console' || k === 'network';
}

export class EventRing {
  private buf: Event[] = [];
  constructor(private readonly cap: number = RING_CAP) {}
  push(ev: Event): void {
    this.buf.push(ev);
    if (this.buf.length > this.cap) this.buf.shift();
  }
  snapshot(): Event[] {
    return this.buf.slice();
  }
  clear(): void {
    this.buf.length = 0;
  }
}

export async function startServer(opts: ServerOptions = {}): Promise<ServerHandle> {
  const port = opts.port ?? Number(Bun.env.PORT ?? 3737);
  const host = opts.host ?? Bun.env.HOST ?? '127.0.0.1';
  const dataDir = opts.dataDir ?? process.cwd();
  await mkdir(dataDir, { recursive: true });
  const LOGS_PATH = `${dataDir}/logs.jsonl`;
  const SUMMARY_PATH = `${dataDir}/summary.json`;

  const store = new GroupStore();
  const ring = new EventRing();
  const summaryWriter = new SummaryWriter(SUMMARY_PATH, store);
  const logsWriter = Bun.file(LOGS_PATH).writer();

  const startedAt = Date.now();

  async function clearAll(): Promise<void> {
    store.reset();
    ring.clear();
    await Bun.write(LOGS_PATH, '');
    await summaryWriter.flush();
  }

  async function handleIngest(req: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: 'invalid json' }, { status: 400 });
    }
    const events = (body as { events?: unknown }).events;
    if (!Array.isArray(events)) return json(req, { error: 'events[] required' }, { status: 400 });

    let accepted = 0;
    for (const raw of events) {
      if (!isEvent(raw)) continue;
      const ev = raw as Event;
      if (!ev.ts) ev.ts = Date.now();
      logsWriter.write(JSON.stringify(ev) + '\n');
      store.ingest(ev);
      ring.push(ev);
      accepted++;
    }
    if (accepted > 0) {
      logsWriter.flush();
      summaryWriter.schedule();
    }
    return json(req, { accepted });
  }

  function filterSummary(params: URLSearchParams) {
    const snap = store.snapshot();
    const kind = params.get('kind');
    const level = params.get('level');
    const limit = Math.max(1, Math.min(500, Number(params.get('limit') ?? 100)));
    const method = params.get('method');
    const statusMin = params.get('statusMin') ? Number(params.get('statusMin')) : undefined;
    const statusMax = params.get('statusMax') ? Number(params.get('statusMax')) : undefined;
    const urlPattern = params.get('urlPattern');

    let cons = snap.console;
    let net = snap.network;
    if (kind === 'console') net = [];
    if (kind === 'network') cons = [];

    if (level) {
      const levels = level.split(',').map((s) => s.trim());
      cons = cons.filter((g) => levels.includes(g.level));
    }
    if (method) {
      const methods = method.split(',').map((s) => s.trim().toUpperCase());
      net = net.filter((g) => methods.includes(g.method.toUpperCase()));
    }
    if (statusMin !== undefined) net = net.filter((g) => g.status >= statusMin);
    if (statusMax !== undefined) net = net.filter((g) => g.status <= statusMax);
    if (urlPattern) {
      try {
        const re = new RegExp(urlPattern);
        net = net.filter((g) => re.test(g.urlPattern));
      } catch {
        /* ignore invalid regex */
      }
    }

    return { ...snap, console: cons.slice(0, limit), network: net.slice(0, limit) };
  }

  function filterLogs(params: URLSearchParams): Event[] {
    const kind = params.get('kind');
    const level = params.get('level');
    const tail = Math.max(1, Math.min(1000, Number(params.get('tail') ?? 50)));
    const grepPattern = params.get('grep');
    let re: RegExp | null = null;
    if (grepPattern) {
      try {
        re = new RegExp(grepPattern);
      } catch {
        /* ignore */
      }
    }
    let events = ring.snapshot();
    if (kind === 'console') events = events.filter((e) => e.kind === 'console');
    if (kind === 'network') events = events.filter((e) => e.kind === 'network');
    if (level) {
      const levels = level.split(',').map((s) => s.trim());
      events = events.filter((e) => e.kind !== 'console' || levels.includes(e.level));
    }
    if (re) events = events.filter((e) => re!.test(JSON.stringify(e)));
    return events.slice(-tail);
  }

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsFor(req) });
      }

      if (req.method === 'GET' && pathname === '/healthz') {
        return json(req, { ok: true, port, host, startedAt, uptimeMs: Date.now() - startedAt });
      }

      if (req.method === 'GET' && pathname === '/capture.js') {
        const file = Bun.file(CAPTURE_PATH as string);
        if (!(await file.exists())) {
          return new Response('// capture.js not built — run `bun run build`', {
            status: 404,
            headers: { 'Content-Type': 'application/javascript', ...corsFor(req) },
          });
        }
        return new Response(file, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-cache',
            ...corsFor(req),
          },
        });
      }

      if (req.method === 'POST' && pathname === '/ingest') return handleIngest(req);

      if (req.method === 'GET' && pathname === '/summary') {
        return json(req, filterSummary(url.searchParams));
      }

      if (req.method === 'GET' && pathname === '/logs') {
        return json(req, { events: filterLogs(url.searchParams) });
      }

      if (req.method === 'POST' && pathname === '/clear') {
        await clearAll();
        return json(req, { ok: true, cleared: true });
      }

      return json(req, { error: 'not found' }, { status: 404 });
    },
  });

  if (!opts.quiet) {
    // eslint-disable-next-line no-console
    console.log(`[bridge] listening http://${server.hostname}:${server.port}`);
    // eslint-disable-next-line no-console
    console.log(`[bridge] data dir  = ${dataDir}`);
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      await summaryWriter.flush();
      logsWriter.end();
    } finally {
      server.stop();
    }
  };

  return { port, host, dataDir, startedAt, store, ring, clear: clearAll, stop };
}

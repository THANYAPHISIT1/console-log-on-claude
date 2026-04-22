export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type ConsoleEvent = {
  kind: 'console';
  level: ConsoleLevel;
  args: unknown[];
  ts: number;
  url: string;
  session?: string;
  stackTop?: string;
};

export type NetworkEvent = {
  kind: 'network';
  api: 'fetch' | 'xhr';
  method: string;
  url: string;
  status: number;
  durationMs: number;
  reqHeaders?: Record<string, string>;
  resHeaders?: Record<string, string>;
  error?: string;
  ts: number;
  session?: string;
};

export type Event = ConsoleEvent | NetworkEvent;

export type ConsoleGroup = {
  kind: 'console';
  signature: string;
  level: ConsoleLevel;
  count: number;
  firstTs: number;
  lastTs: number;
  sample: string;
  latest?: string;
  stackTop?: string;
  urls: string[];
};

export type NetworkGroup = {
  kind: 'network';
  signature: string;
  api: 'fetch' | 'xhr';
  method: string;
  urlPattern: string;
  status: number;
  count: number;
  firstTs: number;
  lastTs: number;
  p50Ms: number;
  p95Ms: number;
  lastError?: string;
};

export type Group = ConsoleGroup | NetworkGroup;

export type Summary = {
  generatedAt: number;
  totals: {
    console: { log: number; info: number; warn: number; error: number; debug: number };
    network: { ok: number; error: number };
  };
  console: ConsoleGroup[];
  network: NetworkGroup[];
};

import type { ConsoleLevel, Event } from './types.ts';
import type { GroupStore } from './group.ts';
import type { EventRing } from './server.ts';

export type DashboardOptions = {
  store: GroupStore;
  ring: EventRing;
  port: number;
  host: string;
  dataDir: string;
  startedAt: number;
  onQuit: () => Promise<void> | void;
  onClear: () => Promise<void> | void;
};

const ESC = '\x1b[';
const CLEAR = `${ESC}2J${ESC}H`;
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;
const RED = `${ESC}31m`;
const YELLOW = `${ESC}33m`;
const GREEN = `${ESC}32m`;
const BLUE = `${ESC}34m`;
const GREY = `${ESC}90m`;

type LevelFilter = 'all' | 'err' | 'errwarn';

export async function runDashboard(opts: DashboardOptions): Promise<void> {
  let paused = false;
  let levelFilter: LevelFilter = 'all';
  let grepRe: RegExp | null = null;
  let inputMode: null | 'grep' = null;
  let inputBuffer = '';
  let exiting = false;

  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdout.write(HIDE_CURSOR);

  const cleanup = () => {
    process.stdout.write(SHOW_CURSOR + RESET + '\n');
    try {
      process.stdin.setRawMode?.(false);
    } catch {
      /* ignore */
    }
    process.stdin.pause();
  };

  const quit = async () => {
    if (exiting) return;
    exiting = true;
    clearInterval(tick);
    cleanup();
    try {
      await opts.onQuit();
    } finally {
      process.exit(0);
    }
  };

  const render = () => {
    if (exiting) return;
    const snap = opts.store.snapshot();
    const events = opts.ring.snapshot();
    const cols = Math.max(60, process.stdout.columns ?? 100);
    const rows = Math.max(18, process.stdout.rows ?? 30);
    const lines: string[] = [];
    const hr = `${DIM}${'─'.repeat(cols - 2)}${RESET}`;

    const uptime = fmtUptime(Date.now() - opts.startedAt);
    const pauseTag = paused ? `  ${YELLOW}[paused]${RESET}` : '';
    lines.push(
      `${BOLD}clc${RESET}  ${DIM}·${RESET}  http://${opts.host}:${opts.port}  ${DIM}·${RESET}  uptime ${uptime}${pauseTag}`,
    );
    lines.push(hr);

    const c = snap.totals.console;
    const n = snap.totals.network;
    const consoleTotal = c.log + c.info + c.warn + c.error + c.debug;
    lines.push(
      `totals  console: ${BOLD}${consoleTotal}${RESET}  (${RED}err ${c.error}${RESET} · ${YELLOW}warn ${c.warn}${RESET} · info ${c.info} · log ${c.log} · debug ${c.debug})`,
    );
    lines.push(
      `        network: ${BOLD}${n.ok + n.error}${RESET}  (${GREEN}ok ${n.ok}${RESET} · ${RED}err ${n.error}${RESET})`,
    );
    lines.push(hr);

    lines.push(`${BOLD}TOP CONSOLE${RESET}  ${DIM}[level: ${levelFilter}]${RESET}`);
    const cons = filterConsoleGroups(snap.console, levelFilter).slice(0, 5);
    if (cons.length === 0) lines.push(`${GREY}  (none)${RESET}`);
    for (const g of cons) {
      const col = colorForLevel(g.level);
      lines.push(
        `  ${col}×${pad(g.count, 3)}${RESET} ${col}${g.level.padEnd(5)}${RESET}  ${truncate(g.sample, cols - 18)}`,
      );
    }
    lines.push(hr);

    lines.push(`${BOLD}TOP NETWORK${RESET}`);
    const net = snap.network.slice(0, 5);
    if (net.length === 0) lines.push(`${GREY}  (none)${RESET}`);
    for (const g of net) {
      const statusCol = g.status >= 500 ? RED : g.status >= 400 ? YELLOW : GREEN;
      lines.push(
        `  ${BOLD}×${pad(g.count, 3)}${RESET} ${g.method.padEnd(5)} ${truncate(g.urlPattern, cols - 36)}  ${statusCol}${g.status}${RESET}  ${DIM}p50=${g.p50Ms}ms p95=${g.p95Ms}ms${RESET}`,
      );
    }
    lines.push(hr);

    const grepTag = grepRe ? `  ${DIM}[grep: ${grepRe.source}]${RESET}` : '';
    lines.push(`${BOLD}LIVE TAIL${RESET}${grepTag}`);
    let liveEvents = events;
    if (levelFilter !== 'all') {
      liveEvents = liveEvents.filter(
        (e) => e.kind !== 'console' || levelMatches(e.level, levelFilter),
      );
    }
    if (grepRe) liveEvents = liveEvents.filter((e) => grepRe!.test(JSON.stringify(e)));
    const tailSpace = Math.max(3, rows - lines.length - 3);
    const tailSlice = liveEvents.slice(-tailSpace);
    if (tailSlice.length === 0) lines.push(`${GREY}  (no events)${RESET}`);
    for (const ev of tailSlice) lines.push('  ' + formatEventLine(ev, cols - 4));

    const help =
      inputMode === 'grep'
        ? `${BOLD}/${inputBuffer}${RESET}${DIM}  Enter=confirm · Esc=cancel${RESET}`
        : `${DIM}[q]uit  [c]lear  [p]${paused ? 'resume' : 'ause'}  [f]level(${levelFilter})  [/]${grepRe ? 'clear-grep' : 'grep'}${RESET}`;

    process.stdout.write(CLEAR + lines.join('\n') + '\n' + help);
  };

  const onKey = async (data: Buffer | string) => {
    const s = typeof data === 'string' ? data : data.toString('utf8');

    if (inputMode === 'grep') {
      if (s === '\r' || s === '\n') {
        try {
          grepRe = inputBuffer ? new RegExp(inputBuffer) : null;
        } catch {
          grepRe = null;
        }
        inputMode = null;
        inputBuffer = '';
        render();
        return;
      }
      if (s === '\x1b') {
        inputMode = null;
        inputBuffer = '';
        render();
        return;
      }
      if (s === '\x7f' || s === '\b') {
        inputBuffer = inputBuffer.slice(0, -1);
        render();
        return;
      }
      if (s >= ' ' && s.length === 1) {
        inputBuffer += s;
        render();
      }
      return;
    }

    if (s === 'q' || s === '\x03') {
      await quit();
      return;
    }
    if (s === 'c') {
      await opts.onClear();
      render();
      return;
    }
    if (s === 'p') {
      paused = !paused;
      render();
      return;
    }
    if (s === 'f') {
      levelFilter = levelFilter === 'all' ? 'err' : levelFilter === 'err' ? 'errwarn' : 'all';
      render();
      return;
    }
    if (s === '/') {
      if (grepRe) {
        grepRe = null;
        render();
        return;
      }
      inputMode = 'grep';
      inputBuffer = '';
      render();
    }
  };

  process.stdin.on('data', onKey);
  process.stdout.on('resize', render);
  process.on('SIGINT', () => void quit());
  process.on('SIGTERM', () => void quit());

  render();
  const tick = setInterval(() => {
    if (!paused) render();
  }, 500);

  return new Promise(() => {
    /* run forever until quit() exits */
  });
}

function fmtUptime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function pad(n: number | string, w: number): string {
  return String(n).padStart(w);
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, ' ').replace(/\s+/g, ' ');
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function colorForLevel(level: ConsoleLevel): string {
  if (level === 'error') return RED;
  if (level === 'warn') return YELLOW;
  if (level === 'info') return BLUE;
  if (level === 'debug') return GREY;
  return '';
}

function filterConsoleGroups<T extends { level: ConsoleLevel }>(arr: T[], f: LevelFilter): T[] {
  if (f === 'all') return arr;
  if (f === 'err') return arr.filter((g) => g.level === 'error');
  return arr.filter((g) => g.level === 'error' || g.level === 'warn');
}

function levelMatches(level: ConsoleLevel, f: LevelFilter): boolean {
  if (f === 'all') return true;
  if (f === 'err') return level === 'error';
  return level === 'error' || level === 'warn';
}

function formatEventLine(ev: Event, maxWidth: number): string {
  const t = new Date(ev.ts).toTimeString().slice(0, 8);
  if (ev.kind === 'console') {
    const col = colorForLevel(ev.level);
    const tag = `${col}${ev.level.slice(0, 3).toUpperCase().padEnd(3)}${RESET}`;
    const msg = stringifyArgsInline(ev.args);
    return `${DIM}${t}${RESET} C ${tag} ${truncate(msg, Math.max(10, maxWidth - 20))}`;
  }
  const statusCol = ev.status >= 500 ? RED : ev.status >= 400 ? YELLOW : GREEN;
  return `${DIM}${t}${RESET} N ${ev.method.padEnd(4)} ${truncate(ev.url, Math.max(10, maxWidth - 30))} ${statusCol}${ev.status}${RESET} ${DIM}${ev.durationMs}ms${RESET}`;
}

function stringifyArgsInline(args: unknown[]): string {
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

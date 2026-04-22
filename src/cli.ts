#!/usr/bin/env bun
import { runStart } from './commands/start.ts';
import { runStatus } from './commands/status.ts';
import { runSummary } from './commands/summary.ts';
import { runLogs } from './commands/logs.ts';
import { runClear } from './commands/clear.ts';
import { runSnippet } from './commands/snippet.ts';

const HELP = `clc — console-log-on-claude bridge

Usage:
  clc start     [--port 3737] [--host 127.0.0.1] [--data-dir .] [--no-dashboard]
  clc status    [--port 3737] [--host 127.0.0.1]
  clc summary   [--kind console|network] [--level err,warn] [--method GET,POST]
                [--status-min 400] [--status-max 599] [--url-pattern regex] [--limit 50]
  clc logs      [--kind console|network] [--level err,warn] [--tail 20] [--grep regex]
  clc clear
  clc snippet   [--session my-app] [--levels warn,error] [--port 3737] [--host 127.0.0.1]
  clc help

All commands other than \`start\` call HTTP on a running bridge server.
Exit codes: 0 ok · 1 error · 2 server unreachable.
`;

type Cmd = 'start' | 'status' | 'summary' | 'logs' | 'clear' | 'snippet' | 'help';

function parseArgs(argv: string[]): { cmd: Cmd; flags: Record<string, string | true> } {
  const [rawCmd, ...rest] = argv;
  const cmd = (rawCmd ?? 'help') as Cmd;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { cmd, flags };
}

const { cmd, flags } = parseArgs(process.argv.slice(2));

switch (cmd) {
  case 'start':
    await runStart(flags);
    break;
  case 'status':
    await runStatus(flags);
    break;
  case 'summary':
    await runSummary(flags);
    break;
  case 'logs':
    await runLogs(flags);
    break;
  case 'clear':
    await runClear(flags);
    break;
  case 'snippet':
    await runSnippet(flags);
    break;
  case 'help':
    process.stdout.write(HELP);
    process.exit(0);
  // eslint-disable-next-line no-fallthrough
  default:
    process.stderr.write(`unknown command: ${cmd}\n\n`);
    process.stdout.write(HELP);
    process.exit(1);
}

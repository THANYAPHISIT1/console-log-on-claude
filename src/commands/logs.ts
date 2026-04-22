import { resolveEndpoint, callJson, failUnreachable } from './http.ts';

export async function runLogs(flags: Record<string, string | true>): Promise<void> {
  const endpoint = resolveEndpoint(flags);
  const params = new URLSearchParams();
  if (typeof flags.kind === 'string') params.set('kind', flags.kind);
  if (typeof flags.level === 'string') params.set('level', flags.level);
  if (typeof flags.tail === 'string') params.set('tail', flags.tail);
  if (typeof flags.grep === 'string') params.set('grep', flags.grep);

  const qs = params.toString();
  const url = qs ? `${endpoint}/logs?${qs}` : `${endpoint}/logs`;
  try {
    const { ok, body } = await callJson(url);
    process.stdout.write(JSON.stringify(body, null, 2) + '\n');
    process.exit(ok ? 0 : 1);
  } catch (err) {
    failUnreachable(endpoint, err);
  }
}

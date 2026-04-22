import { resolveEndpoint, callJson, failUnreachable } from './http.ts';

export async function runSummary(flags: Record<string, string | true>): Promise<void> {
  const endpoint = resolveEndpoint(flags);
  const params = new URLSearchParams();
  if (typeof flags.kind === 'string') params.set('kind', flags.kind);
  if (typeof flags.level === 'string') params.set('level', flags.level);
  if (typeof flags.method === 'string') params.set('method', flags.method);
  if (typeof flags['status-min'] === 'string') params.set('statusMin', flags['status-min']);
  if (typeof flags['status-max'] === 'string') params.set('statusMax', flags['status-max']);
  if (typeof flags['url-pattern'] === 'string') params.set('urlPattern', flags['url-pattern']);
  if (typeof flags.limit === 'string') params.set('limit', flags.limit);

  const qs = params.toString();
  const url = qs ? `${endpoint}/summary?${qs}` : `${endpoint}/summary`;
  try {
    const { ok, body } = await callJson(url);
    process.stdout.write(JSON.stringify(body, null, 2) + '\n');
    process.exit(ok ? 0 : 1);
  } catch (err) {
    failUnreachable(endpoint, err);
  }
}

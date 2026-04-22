import { resolveEndpoint, callJson, failUnreachable } from './http.ts';

export async function runClear(flags: Record<string, string | true>): Promise<void> {
  const endpoint = resolveEndpoint(flags);
  try {
    const { ok, body } = await callJson(`${endpoint}/clear`, { method: 'POST' });
    process.stdout.write(JSON.stringify(body) + '\n');
    process.exit(ok ? 0 : 1);
  } catch (err) {
    failUnreachable(endpoint, err);
  }
}

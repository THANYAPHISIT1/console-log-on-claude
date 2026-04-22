import { resolveEndpoint, callJson, failUnreachable } from './http.ts';

export async function runStatus(flags: Record<string, string | true>): Promise<void> {
  const endpoint = resolveEndpoint(flags);
  try {
    const { ok, body } = await callJson(`${endpoint}/healthz`);
    process.stdout.write(JSON.stringify(body) + '\n');
    process.exit(ok ? 0 : 1);
  } catch (err) {
    failUnreachable(endpoint, err);
  }
}

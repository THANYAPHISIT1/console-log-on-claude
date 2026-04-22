export function resolveEndpoint(flags: Record<string, string | true>): string {
  const port = typeof flags.port === 'string' ? flags.port : '3737';
  const host = typeof flags.host === 'string' ? flags.host : '127.0.0.1';
  return `http://${host}:${port}`;
}

export async function callJson(
  url: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = { error: 'non-json response', status: res.status };
  }
  return { ok: res.ok, status: res.status, body };
}

export function failUnreachable(endpoint: string, err: unknown): never {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: 'server not reachable',
      endpoint,
      detail: String(err),
      hint: 'start the bridge with `clc start`',
    }) + '\n',
  );
  process.exit(2);
}

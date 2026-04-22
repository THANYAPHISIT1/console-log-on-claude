export async function runSnippet(flags: Record<string, string | true>): Promise<void> {
  const port = typeof flags.port === 'string' ? flags.port : '3737';
  const host = typeof flags.host === 'string' ? flags.host : '127.0.0.1';
  const session = typeof flags.session === 'string' ? flags.session : undefined;
  const levels = typeof flags.levels === 'string' ? flags.levels : undefined;

  const attrs = [`src="http://${host}:${port}/capture.js"`];
  if (session) attrs.push(`data-session="${session}"`);
  if (levels) attrs.push(`data-levels="${levels}"`);
  process.stdout.write(`<script ${attrs.join(' ')}></script>\n`);
  process.exit(0);
}

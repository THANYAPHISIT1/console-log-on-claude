import { startServer } from '../server.ts';
import { runDashboard } from '../dashboard.ts';

export async function runStart(flags: Record<string, string | true>): Promise<void> {
  const port = typeof flags.port === 'string' ? Number(flags.port) : undefined;
  const host = typeof flags.host === 'string' ? flags.host : undefined;
  const dataDir = typeof flags['data-dir'] === 'string' ? flags['data-dir'] : undefined;
  const withDashboard = flags['no-dashboard'] !== true;

  const handle = await startServer({ port, host, dataDir, quiet: withDashboard });

  if (withDashboard) {
    await runDashboard({
      store: handle.store,
      ring: handle.ring,
      port: handle.port,
      host: handle.host,
      dataDir: handle.dataDir,
      startedAt: handle.startedAt,
      onQuit: () => handle.stop(),
      onClear: () => handle.clear(),
    });
    return;
  }

  const shutdown = async () => {
    await handle.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise(() => {
    /* keep alive until signal */
  });
}

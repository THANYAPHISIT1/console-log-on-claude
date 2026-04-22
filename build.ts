import { mkdir } from 'node:fs/promises';

const outDir = new URL('./public/', import.meta.url).pathname;
await mkdir(outDir, { recursive: true });

const result = await Bun.build({
  entrypoints: ['./src/capture.ts'],
  outdir: outDir,
  target: 'browser',
  format: 'iife',
  minify: true,
  naming: 'capture.js',
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const bytes = (await Bun.file(`${outDir}capture.js`).arrayBuffer()).byteLength;
console.log(`[build] public/capture.js (${bytes} bytes)`);

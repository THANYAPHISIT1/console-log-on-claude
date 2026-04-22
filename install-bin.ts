import { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const BIN_NAME = 'clc';
const SOURCE = resolve('./dist/clc');
const TARGET_DIR = process.env.CLC_INSTALL_DIR || join(homedir(), '.local', 'bin');
const TARGET = join(TARGET_DIR, BIN_NAME);

if (!existsSync(SOURCE)) {
  console.error(`source binary not found: ${SOURCE}`);
  console.error(`run \`bun run build:bin\` first`);
  process.exit(1);
}

mkdirSync(TARGET_DIR, { recursive: true });

if (existsSync(TARGET) || isBrokenSymlink(TARGET)) unlinkSync(TARGET);
symlinkSync(SOURCE, TARGET);

console.log(`linked ${TARGET} -> ${SOURCE}`);

const pathDirs = (process.env.PATH || '').split(':');
if (!pathDirs.includes(TARGET_DIR)) {
  console.log('');
  console.log(`[warn] ${TARGET_DIR} is not in PATH`);
  console.log(`add this line to ~/.zshrc then reload:`);
  console.log(`  export PATH="${TARGET_DIR}:$PATH"`);
}

function isBrokenSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

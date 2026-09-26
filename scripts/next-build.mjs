import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Heap MB for the Next CLI and forked webpack workers. */
const HEAP_MB = process.env.NEXT_BUILD_HEAP_MB || '3072';

function withHeap(nodeOptions) {
  const parts = (nodeOptions || '')
    .split(/\s+/)
    .filter((part) => part && !/max[-_]old[-_]space[-_]size/i.test(part));
  parts.push(`--max-old-space-size=${HEAP_MB}`);
  return parts.join(' ').trim();
}

process.env.NODE_OPTIONS = withHeap(process.env.NODE_OPTIONS);

const nextBin = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'node_modules',
  'next',
  'dist',
  'bin',
  'next',
);

const child = spawn(
  process.execPath,
  [`--max-old-space-size=${HEAP_MB}`, nextBin, 'build', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

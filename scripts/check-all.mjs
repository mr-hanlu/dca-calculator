import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function run(script) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolve(root, script)], { stdio: 'inherit' });
    child.on('exit', (code) => resolvePromise(code ?? 1));
  });
}

const indexCode = await run('scripts/check-data.mjs');
const etfCode = await run('scripts/check-etf-premium.mjs');
if (indexCode || etfCode) process.exitCode = 1;

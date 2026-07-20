import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const forwarded = process.argv.slice(2);

function run(script, args = []) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolve(root, script), ...args], { stdio: 'inherit' });
    child.on('exit', (code) => resolvePromise(code ?? 1));
  });
}

const indexArgs = forwarded.filter((item, index, values) => {
  if (item === '--etf-file' || item === '--etf') return false;
  if (index > 0 && (values[index - 1] === '--etf-file' || values[index - 1] === '--etf')) return false;
  return true;
});

const indexCode = await run('scripts/update-data.mjs', indexArgs);
const etfCode = await run('scripts/update-etf-premium.mjs', forwarded);
if (indexCode || etfCode) process.exitCode = 1;

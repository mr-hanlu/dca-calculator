import { readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const registryPath = resolve(root, 'public/data/indices.json');
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    result[key] = next && !next.startsWith('--') ? argv[++i] : true;
  }
  return result;
}

const required = ['id', 'name', 'short-name', 'currency', 'inception', 'source-label', 'source-url', 'file'];
const missing = required.filter((key) => !args[key]);
if (missing.length) throw new Error(`缺少参数：${missing.map((key) => `--${key}`).join(', ')}`);
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.id)) {
  throw new Error('--id 只能使用小写英文字母、数字和连字符');
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(args.inception)) {
  throw new Error('--inception 必须使用 YYYY-MM-DD 格式');
}

const original = await readFile(registryPath, 'utf8');
const registry = JSON.parse(original);
if (registry.indices.some((index) => index.id === args.id)) throw new Error(`指数 ${args.id} 已存在`);

registry.indices.push({
  id: args.id,
  name: args.name,
  shortName: args['short-name'],
  description: args.description || `${args.name}价格指数`,
  currency: String(args.currency).toUpperCase(),
  dataFile: `/data/${args.id}.json`,
  inceptionDate: args.inception,
  firstDataDate: null,
  lastDataDate: null,
  priceType: 'price-index',
  source: {
    provider: 'csv',
    symbol: args.symbol || '',
    label: args['source-label'],
    url: args['source-url']
  }
});

await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
try {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    resolve(root, 'scripts/update-data.mjs'),
    '--index', args.id,
    '--file', resolve(args.file)
  ], { cwd: root });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  console.log(`已添加 ${args.name}。请运行 npm run data:check，然后本地预览。`);
} catch (error) {
  await writeFile(registryPath, original);
  await rm(resolve(root, `public/data/${args.id}.json`), { force: true });
  throw new Error(`添加失败，已回滚注册表：${error.stderr || error.message}`);
}

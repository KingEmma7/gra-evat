import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'gra-evat-packed-'));
let server;
function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
try {
  run('pnpm', ['pack', '--pack-destination', temporary], join(root, 'packages/core'));
  const archive = (await readdir(temporary)).find((name) => name.endsWith('.tgz'));
  if (!archive) throw new Error('pnpm pack did not produce an archive');
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, archive)],
    temporary,
  );
  await copyFile(join(root, 'examples/node-basic/index.mjs'), join(temporary, 'index.mjs'));
  await copyFile(join(root, 'examples/node-basic/index.cjs'), join(temporary, 'index.cjs'));

  const port = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        address && typeof address !== 'string'
          ? resolve(address.port)
          : reject(new Error('No port')),
      );
    });
  });
  server = spawn(process.execPath, ['packages/mock/dist/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      MOCK_SEED: 'packed-verification',
      MOCK_LATENCY_MS: '0',
      MOCK_FAIL_STATUS: '',
    },
    stdio: 'ignore',
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/vsdc/api/v1/taxpayer/C0000000000-001/health`, {
        headers: { security_key: 'mock' },
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the local child process to bind. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Packed example mock server did not start');
  const esm = run(process.execPath, ['index.mjs'], temporary, {
    ...process.env,
    GRA_BASE_URL: baseUrl,
    GRA_SECURITY_KEY: 'mock',
    GRA_TAXPAYER_ID: 'C0000000000-001',
  });
  const cjs = run(process.execPath, ['index.cjs'], temporary);
  if (!JSON.parse(esm).ok || cjs.trim() !== 'GHS 120.00')
    throw new Error('Packed package examples returned unexpected output');
  console.log(
    'Packed core verified: standalone ESM invoice example and CJS calculator example passed.',
  );
} finally {
  if (server) {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once('exit', resolve);
    });
  }
  await rm(temporary, { recursive: true, force: true });
}

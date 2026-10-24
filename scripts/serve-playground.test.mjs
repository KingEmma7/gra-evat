import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createPreviewServer } from './serve-playground.mjs';

test('static preview serves deep routes, fonts and headers without exposing files outside export', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'gra-static-'));
  const root = path.join(temporary, 'out');
  await mkdir(path.join(root, 'guide'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<h1>Home</h1>');
  await writeFile(path.join(root, 'guide/index.html'), '<h1>Guide</h1>');
  await writeFile(path.join(root, '404.html'), '<h1>Not found</h1>');
  await writeFile(path.join(root, 'font.woff2'), 'local font');
  await writeFile(
    path.join(root, '_headers'),
    "/*\n  Content-Security-Policy: default-src 'self'\n",
  );
  await writeFile(path.join(temporary, 'private.txt'), 'must stay outside');
  await symlink(path.join(temporary, 'private.txt'), path.join(root, 'link.txt'));
  const server = await createPreviewServer(root);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('Content-Security-Policy'), "default-src 'self'");
    const redirect = await fetch(`${origin}/guide?view=1`, { redirect: 'manual' });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), '/guide/?view=1');
    assert.equal(await (await fetch(`${origin}/guide/`)).text(), '<h1>Guide</h1>');
    const font = await fetch(`${origin}/font.woff2`, { method: 'HEAD' });
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.equal(await font.text(), '');
    for (const pathname of ['/missing', '/_headers', '/link.txt', '/%2e%2e%2fprivate.txt']) {
      const response = await fetch(origin + pathname);
      assert.equal(response.status, 404, pathname);
      assert.equal(await response.text(), '<h1>Not found</h1>');
    }
    assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(temporary, { recursive: true, force: true });
  }
});

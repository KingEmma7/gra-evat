import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { Response, URL } = globalThis;
import {
  contextFromEnv,
  deploymentGate,
  prepareArtifact,
  verifyArtifact,
  verifyLive,
} from './deployment.mjs';

const context = {
  repository: 'KingEmma7/gra-evat',
  commit: 'a'.repeat(40),
  runId: '123',
  runAttempt: '1',
};
const env = {
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: context.repository,
  GITHUB_SHA: context.commit,
  GITHUB_RUN_ID: context.runId,
  GITHUB_RUN_ATTEMPT: context.runAttempt,
};
const merged = {
  number: 7,
  state: 'closed',
  merged_at: '2026-10-26T12:00:00Z',
  merge_commit_sha: context.commit,
  base: { ref: 'main', repo: { full_name: context.repository } },
};
const head = (sha = context.commit) => ({ object: { sha } });
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
function responses(...values) {
  let count = 0;
  return {
    request: async () => {
      assert.ok(count < values.length, 'Unexpected request');
      return json(values[count++]);
    },
    count: () => count,
  };
}

test('deployment context rejects PR events, other branches, forks and malformed identities', () => {
  assert.deepEqual(contextFromEnv(env), context);
  for (const change of [
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_EVENT_NAME: 'workflow_run' },
    { GITHUB_REF: 'refs/heads/topic' },
    { GITHUB_REPOSITORY: 'someone/gra-evat' },
    { GITHUB_SHA: 'main' },
    { GITHUB_RUN_ID: '../123' },
  ]) {
    assert.throws(() => contextFromEnv({ ...env, ...change }));
  }
});

test('exact current main commit with a matching merged PR passes two head reads', async () => {
  const mock = responses(head(), [merged], head());
  assert.deepEqual(await deploymentGate(context, mock.request, 'test-only'), {
    deploy: true,
    pullRequest: 7,
  });
  assert.equal(mock.count(), 3);
});

test('older successful runs skip before publication, including a head change during the gate', async () => {
  const old = responses(head('b'.repeat(40)));
  assert.equal((await deploymentGate(context, old.request, 'test-only')).deploy, false);
  assert.equal(old.count(), 1);
  const race = responses(head(), [merged], head('b'.repeat(40)));
  assert.equal((await deploymentGate(context, race.request, 'test-only')).deploy, false);
});

test('unmerged, different-base, different-commit and direct main pushes fail closed', async () => {
  for (const pulls of [
    [],
    [{ ...merged, merged_at: null }],
    [{ ...merged, state: 'open' }],
    [{ ...merged, merge_commit_sha: 'b'.repeat(40) }],
    [{ ...merged, base: { ...merged.base, ref: 'topic' } }],
    [{ ...merged, base: { ref: 'main', repo: { full_name: 'someone/gra-evat' } } }],
  ]) {
    const mock = responses(head(), pulls);
    await assert.rejects(deploymentGate(context, mock.request, 'test-only'), /not associated/);
  }
});

test('missing credentials and GitHub failures cannot authorize a deployment', async () => {
  await assert.rejects(
    deploymentGate(context, async () => json({}), ''),
    /token is missing/,
  );
  await assert.rejects(
    deploymentGate(context, async () => json({}, 403), 'test-only'),
    /HTTP 403/,
  );
});

const security = {
  'content-security-policy': "default-src 'self'; script-src 'self'; object-src 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

async function fixture(t, repository = context.repository) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deployment-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const name = repository.split('/')[1];
  const output = name === 'gra-evat' ? 'apps/playground/out' : 'out';
  await mkdir(path.join(root, output), { recursive: true });
  for (const file of ['index.html', '404.html'])
    await writeFile(path.join(root, output, file), '<!doctype html><title>Fixture</title>');
  await writeFile(
    path.join(root, output, '_headers'),
    '/*\n' +
      Object.entries(security)
        .map(([key, value]) => '  ' + key + ': ' + value)
        .join('\n') +
      '\n',
  );
  await writeFile(
    path.join(root, 'wrangler.jsonc'),
    JSON.stringify({
      name,
      compatibility_date: '2026-10-13',
      workers_dev: true,
      preview_urls: false,
      assets: {
        directory: './' + output,
        html_handling: name === 'vat-check-gh' ? 'auto-trailing-slash' : 'force-trailing-slash',
        not_found_handling: '404-page',
      },
    }),
  );
  return {
    root,
    output,
    destination: path.join(root, 'artifact'),
    context: { ...context, repository },
  };
}

test('all three static configurations package exact files and run identity without source files', async (t) => {
  for (const repository of [
    'KingEmma7/gra-evat',
    'KingEmma7/momo-lens',
    'KingEmma7/vat-check-gh',
  ]) {
    const f = await fixture(t, repository);
    await writeFile(path.join(f.root, '.env'), 'NOT A REAL SECRET: excluded fixture');
    const release = await prepareArtifact(f.root, f.destination, f.context);
    assert.equal(release.files.length, 4);
    assert.equal(
      release.files.some((file) => file.path === '.env'),
      false,
    );
    await verifyArtifact(f.destination, f.context);
    assert.equal(
      JSON.parse(await readFile(path.join(f.destination, 'wrangler.json'), 'utf8')).assets
        .directory,
      './site',
    );
    assert.equal(
      await readFile(path.join(f.destination, 'site', '_headers'), 'utf8'),
      await readFile(path.join(f.root, f.output, '_headers'), 'utf8'),
    );
  }
});

test('artifact verification rejects content tampering, extra files and a different run identity', async (t) => {
  const f = await fixture(t);
  await prepareArtifact(f.root, f.destination, context);
  await assert.rejects(
    verifyArtifact(f.destination, { ...context, runId: '124' }),
    /context mismatch/,
  );
  await writeFile(path.join(f.destination, 'site', 'unexpected.txt'), 'not verified');
  await assert.rejects(verifyArtifact(f.destination, context), /files differ/);
  await rm(path.join(f.destination, 'site', 'unexpected.txt'));
  await writeFile(path.join(f.destination, 'site', 'index.html'), 'tampered');
  await assert.rejects(verifyArtifact(f.destination, context), /files differ/);
});

test('symlinks and Worker code configuration cannot enter a static deployment', async (t) => {
  const f = await fixture(t);
  await symlink(path.join(f.root, 'wrangler.jsonc'), path.join(f.root, f.output, 'link'));
  await assert.rejects(prepareArtifact(f.root, f.destination, context), /symbolic link/);
  await rm(path.join(f.root, f.output, 'link'));
  const config = JSON.parse(await readFile(path.join(f.root, 'wrangler.jsonc'), 'utf8'));
  await writeFile(
    path.join(f.root, 'wrangler.jsonc'),
    JSON.stringify({ ...config, main: 'unexpected-worker.js' }),
  );
  await assert.rejects(prepareArtifact(f.root, f.destination, context));
});

test('live verification checks the exact marker, generated security headers and real 404', async (t) => {
  const f = await fixture(t);
  await prepareArtifact(f.root, f.destination, context);
  let calls = 0;
  const request = async (url) => {
    calls++;
    assert.equal(new URL(url).origin, 'https://gra-evat.etagbor.workers.dev');
    if (url.includes('/__deployment.json')) return json(context);
    if (url.includes('/__missing-')) return new Response('Not found', { status: 404 });
    return new Response('Home', { headers: security });
  };
  assert.equal((await verifyLive(f.destination, context, request)).commit, context.commit);
  assert.equal(calls, 3);
  await assert.rejects(
    verifyLive(f.destination, context, async () => json({ ...context, commit: 'b'.repeat(40) })),
    /not this exact build/,
  );
  await assert.rejects(
    verifyLive(f.destination, context, async (url) =>
      url.includes('/__deployment.json') ? json(context) : new Response('Home'),
    ),
    /header policy differs/,
  );
  await assert.rejects(
    verifyLive(f.destination, context, async (url) =>
      url.includes('/__deployment.json')
        ? json(context)
        : new Response('SPA fallback', { headers: security }),
    ),
    /Unknown paths must return 404/,
  );
});

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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

test('publication removes generated Wrangler state but rejects preexisting or changed artifact files', async (t) => {
  const f = await fixture(t);
  const original = await prepareArtifact(f.root, f.destination, context);
  const tool = path.join(f.root, 'wrangler-fixture.mjs');
  await writeFile(
    tool,
    `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
    import { createHash } from 'node:crypto';
    if (process.env.GH_TOKEN) throw new Error('GitHub token reached the publication child');
    mkdirSync('.wrangler/cache', { recursive: true });
    writeFileSync('.wrangler/cache/state.json', '{}');
    if (process.env.TAMPER_SITE) writeFileSync('site/index.html', 'changed');
    if (process.env.EXTRA_FILE) writeFileSync('unexpected.txt', 'not verified');
    if (process.env.TAMPER_CONFIG) writeFileSync('wrangler.json', '{}');
    if (process.env.REWRITE_MANIFEST) {
      writeFileSync('site/index.html', 'changed');
      const release = JSON.parse(readFileSync('release.json', 'utf8'));
      Object.assign(release.files.find(file => file.path === 'index.html'), { bytes: 7, sha256: createHash('sha256').update('changed').digest('hex') });
      writeFileSync('release.json', JSON.stringify(release));
    }
  `,
  );
  const preload = path.join(f.root, 'github-fixture.mjs');
  await writeFile(
    preload,
    `globalThis.fetch = async (url) => {
    if (!url.startsWith('https://api.github.com/repos/KingEmma7/gra-evat/')) throw new Error('Unexpected request');
    return new Response(JSON.stringify(url.includes('/pulls?') ? ${JSON.stringify([merged])} : ${JSON.stringify(head())}), { status: 200 });
  };`,
  );
  const childEnv = {
    ...process.env,
    ...env,
    GH_TOKEN: 'test-only',
    CLOUDFLARE_API_TOKEN: 'not-a-real-token',
    CLOUDFLARE_ACCOUNT_ID: 'fixture',
    DEPLOY_ARTIFACT_DIR: f.destination,
    WRANGLER_BIN: tool,
    GITHUB_OUTPUT: path.join(f.root, 'output'),
  };
  const publish = (extra = {}) =>
    spawnSync(
      process.execPath,
      ['--import', preload, fileURLToPath(new URL('./deployment.mjs', import.meta.url)), 'publish'],
      { env: { ...childEnv, ...extra }, encoding: 'utf8' },
    );
  const result = publish();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await verifyArtifact(f.destination, context), original);
  await mkdir(path.join(f.destination, '.wrangler'));
  assert.notEqual(publish().status, 0, 'Preexisting state must fail before invoking Wrangler');
  await rm(path.join(f.destination, '.wrangler'), { recursive: true });
  assert.notEqual(
    publish({ EXTRA_FILE: '1' }).status,
    0,
    'Unknown artifact-root files must remain fatal',
  );
  await rm(path.join(f.destination, 'unexpected.txt'));
  const config = await readFile(path.join(f.destination, 'wrangler.json'));
  assert.notEqual(
    publish({ TAMPER_CONFIG: '1' }).status,
    0,
    'Changed configuration must remain fatal',
  );
  await writeFile(path.join(f.destination, 'wrangler.json'), config);
  const index = await readFile(path.join(f.destination, 'site', 'index.html'));
  assert.notEqual(
    publish({ REWRITE_MANIFEST: '1' }).status,
    0,
    'Rewriting hashes must not authorize changed content',
  );
  await writeFile(path.join(f.destination, 'release.json'), JSON.stringify(original));
  await writeFile(path.join(f.destination, 'site', 'index.html'), index);
  const tamper = publish({ TAMPER_SITE: '1' });
  assert.notEqual(tamper.status, 0);
  assert.match(tamper.stderr, /files differ/);
  assert.equal(await readFile(childEnv.GITHUB_OUTPUT, 'utf8'), 'deployed=true\n');
});

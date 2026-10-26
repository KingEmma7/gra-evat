import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';

const { AbortSignal, fetch } = globalThis;
import { createHash } from 'node:crypto';
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  lstat,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const projects = {
  'KingEmma7/gra-evat': {
    name: 'gra-evat',
    output: 'apps/playground/out',
    html: 'force-trailing-slash',
  },
  'KingEmma7/momo-lens': { name: 'momo-lens', output: 'out', html: 'force-trailing-slash' },
  'KingEmma7/vat-check-gh': { name: 'vat-check-gh', output: 'out', html: 'auto-trailing-slash' },
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const markerName = '__deployment.json';

export function contextFromEnv(env = process.env) {
  const context = {
    repository: env.GITHUB_REPOSITORY,
    commit: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
  };
  assert.equal(env.GITHUB_EVENT_NAME, 'push', 'Only a main push can deploy');
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Only main can deploy');
  assert.ok(Object.hasOwn(projects, context.repository), 'Unexpected repository');
  assert.match(context.commit ?? '', /^[a-f0-9]{40}$/);
  assert.match(context.runId ?? '', /^\d+$/);
  assert.match(context.runAttempt ?? '', /^\d+$/);
  return context;
}

export async function inventory(directory) {
  const files = [];
  async function visit(relative) {
    const absolute = path.join(directory, relative);
    const stat = await lstat(absolute);
    assert.ok(!stat.isSymbolicLink(), 'Deployment contains a symbolic link: ' + relative);
    if (stat.isDirectory()) {
      for (const entry of (await readdir(absolute)).sort()) {
        assert.ok(
          !['.git', 'node_modules', '.env', '.env.local', '.env.production'].includes(entry),
          'Unexpected private path',
        );
        await visit(path.join(relative, entry));
      }
    } else {
      assert.ok(stat.isFile(), 'Deployment contains a special file');
      const bytes = await readFile(absolute);
      files.push({
        path: relative.split(path.sep).join('/'),
        bytes: bytes.length,
        sha256: digest(bytes),
      });
    }
  }
  await visit('');
  return files;
}

function staticConfig(text, project) {
  // The checked-in JSONC uses trailing commas only. Other syntax fails closed.
  const config = JSON.parse(text.replace(/,\s*(?=[}\]])/g, ''));
  assert.deepEqual(Object.keys(config).sort(), [
    'assets',
    'compatibility_date',
    'name',
    'preview_urls',
    'workers_dev',
  ]);
  assert.deepEqual(Object.keys(config.assets).sort(), [
    'directory',
    'html_handling',
    'not_found_handling',
  ]);
  assert.equal(config.name, project.name);
  assert.match(config.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.assets.directory.replace(/^\.\//, ''), project.output);
  assert.equal(config.assets.html_handling, project.html);
  assert.equal(config.assets.not_found_handling, '404-page');
  return { ...config, assets: { ...config.assets, directory: './site' } };
}

export async function prepareArtifact(root, destination, context) {
  const project = projects[context.repository];
  assert.ok(project, 'Unexpected repository');
  const config = staticConfig(await readFile(path.join(root, 'wrangler.jsonc'), 'utf8'), project);
  const output = path.join(root, project.output);
  const files = await inventory(output);
  for (const required of ['index.html', '_headers', '404.html']) {
    assert.ok(
      files.some((file) => file.path === required),
      'Missing exported ' + required,
    );
  }
  assert.ok(
    !files.some((file) => file.path === markerName),
    'Reserved deployment marker already exists',
  );
  // A fresh directory prevents accidentally publishing files from an older run.
  await mkdir(destination);
  for (const file of files) {
    const target = path.join(destination, 'site', file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(output, file.path), target);
  }
  await writeFile(path.join(destination, 'site', markerName), JSON.stringify(context) + '\n');
  await writeFile(path.join(destination, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');
  const manifest = {
    ...context,
    files: await inventory(path.join(destination, 'site')),
    configSha256: digest(await readFile(path.join(destination, 'wrangler.json'))),
  };
  await writeFile(path.join(destination, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export async function verifyArtifact(directory, context) {
  assert.deepEqual((await readdir(directory)).sort(), ['release.json', 'site', 'wrangler.json']);
  for (const name of ['release.json', 'wrangler.json']) {
    assert.ok(
      (await lstat(path.join(directory, name))).isFile(),
      'Artifact metadata must be a regular file',
    );
  }
  const manifest = JSON.parse(await readFile(path.join(directory, 'release.json'), 'utf8'));
  for (const [key, value] of Object.entries(context))
    assert.equal(manifest[key], value, 'Artifact context mismatch: ' + key);
  assert.deepEqual(
    await inventory(path.join(directory, 'site')),
    manifest.files,
    'Artifact files differ from the verified build',
  );
  assert.equal(
    digest(await readFile(path.join(directory, 'wrangler.json'))),
    manifest.configSha256,
  );
  const config = JSON.parse(await readFile(path.join(directory, 'wrangler.json'), 'utf8'));
  const project = projects[context.repository];
  staticConfig(
    JSON.stringify({ ...config, assets: { ...config.assets, directory: project.output } }),
    project,
  );
  assert.equal(config.assets.directory, './site');
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, 'site', markerName), 'utf8')),
    context,
  );
  return manifest;
}

export async function deploymentGate(context, request, token) {
  assert.ok(token, 'GitHub read token is missing');
  const base = 'https://api.github.com/repos/' + context.repository;
  const get = async (endpoint) => {
    const response = await request(base + endpoint, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    assert.ok(response.ok, 'GitHub deployment gate failed: HTTP ' + response.status);
    return response.json();
  };
  const head = await get('/git/ref/heads/main');
  if (head.object.sha !== context.commit)
    return { deploy: false, reason: 'Main has advanced; skip this older successful run.' };
  const pulls = await get('/commits/' + context.commit + '/pulls?per_page=100');
  const merged = pulls.find(
    (pull) =>
      pull.state === 'closed' &&
      pull.merged_at &&
      pull.merge_commit_sha === context.commit &&
      pull.base?.ref === 'main' &&
      pull.base?.repo?.full_name === context.repository,
  );
  assert.ok(merged, 'The exact main commit is not associated with a merged pull request');
  // Recheck after the PR request, immediately before the caller starts Wrangler.
  const latest = await get('/git/ref/heads/main');
  if (latest.object.sha !== context.commit)
    return { deploy: false, reason: 'Main advanced during the deployment gate.' };
  return { deploy: true, pullRequest: merged.number };
}

export function expectedHomeHeaders(text) {
  const headers = {};
  let applies = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      applies = line === '/*' || line === '/';
      continue;
    }
    if (applies) {
      const match = line.trim().match(/^([^:]+):\s*(.*)$/);
      if (match) headers[match[1].toLowerCase()] = match[2];
    }
  }
  for (const name of [
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
  ]) {
    assert.ok(headers[name], 'Missing expected security header: ' + name);
  }
  return headers;
}

export async function verifyLive(directory, context, request = fetch) {
  const origin = 'https://' + projects[context.repository].name + '.etagbor.workers.dev';
  const query = '?deployment=' + context.commit + '-' + context.runId + '-' + context.runAttempt;
  const get = (route) =>
    request(origin + route + query, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  const marker = await get('/' + markerName);
  assert.equal(marker.status, 200, 'Live deployment marker is unavailable');
  assert.match(marker.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await marker.json(), context, 'Live marker is not this exact build');
  const home = await get('/');
  assert.equal(home.status, 200, 'Home page is unavailable');
  const expected = expectedHomeHeaders(
    await readFile(path.join(directory, 'site', '_headers'), 'utf8'),
  );
  for (const [name, value] of Object.entries(expected)) {
    if (name === 'cache-control') continue;
    assert.equal(home.headers.get(name), value, 'Live security/header policy differs: ' + name);
  }
  const missing = await get('/__missing-' + context.commit + '/');
  assert.equal(missing.status, 404, 'Unknown paths must return 404');
  return {
    origin,
    commit: context.commit,
    marker: 'pass',
    securityHeaders: 'pass',
    notFound: 'pass',
  };
}

async function main() {
  const context = contextFromEnv();
  const directory = process.env.DEPLOY_ARTIFACT_DIR;
  assert.ok(directory, 'DEPLOY_ARTIFACT_DIR is required');
  const command = process.argv[2];
  if (command === 'prepare') return prepareArtifact(process.cwd(), directory, context);
  const manifest = await verifyArtifact(directory, context);
  if (command === 'publish') {
    const tool = process.env.WRANGLER_BIN;
    assert.ok(tool && path.isAbsolute(tool), 'An isolated absolute Wrangler path is required');
    assert.ok(
      process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID,
      'Cloudflare deployment credentials are missing',
    );
    const gate = await deploymentGate(context, fetch, process.env.GH_TOKEN);
    if (!gate.deploy) {
      console.log(gate.reason);
      await appendFile(process.env.GITHUB_OUTPUT, 'deployed=false\n');
      return;
    }
    const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
    delete env.GH_TOKEN;
    const result = spawnSync(
      process.execPath,
      [
        tool,
        'deploy',
        '--config',
        'wrangler.json',
        '--message',
        context.repository + '@' + context.commit,
      ],
      { cwd: directory, env, stdio: 'inherit' },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, 'Cloudflare deployment failed');
    // Wrangler creates local cache state beside its config after publication.
    // Pre-publish verification excluded this path; all other changes stay fatal.
    await rm(path.join(directory, '.wrangler'), { recursive: true, force: true });
    assert.deepEqual(await verifyArtifact(directory, context), manifest);
    await appendFile(process.env.GITHUB_OUTPUT, 'deployed=true\n');
    return;
  }
  assert.equal(command, 'verify-live', 'Unknown deployment command');
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const result = await verifyLive(directory, context);
      console.log(JSON.stringify(result));
      if (process.env.GITHUB_STEP_SUMMARY)
        await appendFile(
          process.env.GITHUB_STEP_SUMMARY,
          'Deployed ' +
            context.repository +
            ' commit ' +
            context.commit +
            '\n\n' +
            result.origin +
            '\n\nLive marker, generated security headers and 404 checks passed.\n',
        );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await delay(10_000);
    }
  }
  throw lastError;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

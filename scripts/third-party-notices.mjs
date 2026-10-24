import {
  readFileSync as readFile,
  readdirSync as readdir,
  realpathSync as realpath,
  statSync as stat,
  writeFileSync as writeFile,
  mkdirSync as mkdir,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const app = workspace.name === 'gra-evat' ? path.join(root, 'apps/playground') : root;
const seen = new Set();
const entries = [];
const missing = [];
// Native optional packages are installed tools, not copied into browser output.
const nativeOnly = /^(?:@next\/swc-|@img\/sharp-|@napi-rs\/canvas(?:-|$))/;
const noticeName = /^(licen[cs]e|copying|notice|copyright)(?:[.-]|$)/i;

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
async function resolvePackage(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (await exists(path.join(candidate, 'package.json'))) return realpath(candidate);
    if (path.dirname(dir) === dir) return null;
  }
}
async function collectNotices(dir, prefix = '') {
  const result = [];
  for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (item.isFile() && noticeName.test(item.name)) {
      result.push({
        file: prefix + item.name,
        text: (await readFile(path.join(dir, item.name), 'utf8')).trim(),
      });
    }
  }
  return result;
}
async function visit(dir, isRoot = false) {
  dir = await realpath(dir);
  if (seen.has(dir)) return;
  seen.add(dir);
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  if (nativeOnly.test(pkg.name)) return;
  if (!isRoot && !pkg.name.startsWith('@gra-evat/')) {
    const notices = await collectNotices(dir);
    // Next vendors its browser framework and other components in dist/compiled.
    if (pkg.name === 'next') {
      const compiled = path.join(dir, 'dist/compiled');
      for (const item of (await readdir(compiled, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (item.isDirectory()) {
          notices.push(
            ...(await collectNotices(
              path.join(compiled, item.name),
              `dist/compiled/${item.name}/`,
            )),
          );
          if (item.name.startsWith('@')) {
            for (const child of await readdir(path.join(compiled, item.name), {
              withFileTypes: true,
            })) {
              if (child.isDirectory())
                notices.push(
                  ...(await collectNotices(
                    path.join(compiled, item.name, child.name),
                    `dist/compiled/${item.name}/${child.name}/`,
                  )),
                );
            }
          }
        }
      }
    }
    if (pkg.name === 'victory-vendor') {
      const vendor = path.join(dir, 'lib-vendor');
      for (const item of (await readdir(vendor, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (item.isDirectory())
          notices.push(
            ...(await collectNotices(path.join(vendor, item.name), `lib-vendor/${item.name}/`)),
          );
      }
    }
    const fallback = path.join(root, 'docs/licenses', `${pkg.name}-${pkg.version}.txt`);
    if (['react-remove-scroll-bar', 'victory-vendor'].includes(pkg.name)) {
      if (!(await exists(fallback)))
        throw new Error(`Review upstream notice for ${pkg.name}@${pkg.version}`);
      notices.push({
        file: `upstream repository notice (${pkg.name}@${pkg.version})`,
        text: await readFile(fallback, 'utf8'),
      });
    }
    // These monorepo packages omit the repository licence from their npm archives.
    if (pkg.name === '@next/env') {
      const parent = await resolvePackage('next', app);
      const parentPkg = JSON.parse(await readFile(path.join(parent, 'package.json'), 'utf8'));
      if (parentPkg.version !== pkg.version)
        throw new Error('Review Next.js licence version mismatch');
      notices.push(...(await collectNotices(parent, 'Next.js repository/')));
    }
    if (pkg.name === 'client-only' && pkg.version === '0.0.1') {
      notices.push(
        ...(await collectNotices(await resolvePackage('react', app), 'React repository/')),
      );
    }
    if (!notices.length) missing.push(`${pkg.name}@${pkg.version}`);
    entries.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? pkg.licenses ?? 'not declared',
      author: typeof pkg.author === 'object' ? pkg.author.name : pkg.author,
      repository: typeof pkg.repository === 'object' ? pkg.repository.url : pkg.repository,
      notices,
    });
  }
  const deps = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  for (const name of [...deps].sort()) {
    const resolved = await resolvePackage(name, dir);
    if (resolved) await visit(resolved);
    else if (
      Object.hasOwn(pkg.dependencies ?? {}, name) &&
      !Object.hasOwn(pkg.optionalDependencies ?? {}, name)
    )
      throw new Error(`Missing dependency ${name} from ${pkg.name}`);
  }
}
await visit(app, true);
entries.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
const lines = [
  `${workspace.name}: third-party licence and attribution notices`,
  '',
  'Generated from installed production dependencies, their installed optional dependencies,',
  'and vendored Next.js notices. This deliberately includes build/server components that',
  'may not be present in the browser bundles. Separate dependencies retain their own licences.',
  'The application source is MIT licensed. See docs/THIRD_PARTY.md for distribution scope.',
  '',
];
for (const entry of entries) {
  lines.push(
    '='.repeat(72),
    `${entry.name}@${entry.version}`,
    `Declared licence: ${typeof entry.license === 'string' ? entry.license : JSON.stringify(entry.license)}`,
    '',
  );
  if (entry.author) lines.push(`Declared author: ${entry.author}`);
  if (entry.repository) lines.push(`Upstream repository: ${entry.repository}`);
  lines.push('');
  for (const notice of entry.notices) lines.push(`--- ${notice.file} ---`, notice.text, '');
}
if (missing.length) throw new Error(`Missing licence text: ${missing.join(', ')}`);
if (workspace.name === 'momo-lens')
  lines.push(
    '='.repeat(72),
    'Inter Tight font: public/fonts/OFL.txt',
    await readFile(path.join(app, 'public/fonts/OFL.txt'), 'utf8'),
  );
await mkdir(path.join(app, 'public'), { recursive: true });
const output = path.join(app, 'public/THIRD_PARTY_NOTICES.txt');
await writeFile(output, `${lines.join('\n')}\n`);
process.stdout.write(
  `${entries.length} dependency notices written to ${path.relative(root, output)}\n`,
);

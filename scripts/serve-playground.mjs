import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export async function createPreviewServer(directory) {
  const root = await realpath(directory);
  const headers = Object.fromEntries(
    (await readFile(path.join(root, '_headers'), 'utf8'))
      .split('\n')
      .filter((line) => /^\s+[^:]+:/.test(line))
      .map((line) => {
        const colon = line.indexOf(':');
        return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
      }),
  );
  return createServer(async (request, response) => {
    const send = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
      response.writeHead(status, { ...headers, 'Content-Type': type, ...extra });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(405, 'Method not allowed', undefined, { Allow: 'GET, HEAD' });
      return;
    }
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0') || pathname.includes('\\')) throw new Error('Invalid path');
      let file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(`${root}${path.sep}`) && file !== root)
        throw new Error('Outside export');
      if ((await stat(file)).isDirectory()) {
        if (!pathname.endsWith('/')) {
          send(308, '', undefined, { Location: `${url.pathname}/${url.search}` });
          return;
        }
        file = path.join(file, 'index.html');
      }
      file = await realpath(file);
      if (!file.startsWith(`${root}${path.sep}`) || path.basename(file).startsWith('_headers'))
        throw new Error('Private file');
      send(200, await readFile(file), types[path.extname(file)] || 'application/octet-stream');
    } catch {
      send(404, await readFile(path.join(root, '404.html')), 'text/html; charset=utf-8');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = process.argv.indexOf('--port');
  const port = Number(argument >= 0 ? process.argv[argument + 1] : process.env.PORT || 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const server = await createPreviewServer(new URL('../apps/playground/out', import.meta.url));
  server.listen(port, '127.0.0.1', () =>
    console.log(`Static playground: http://127.0.0.1:${port}`),
  );
}

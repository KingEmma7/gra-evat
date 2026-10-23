import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const entry = await readFile(new URL('../packages/core/dist/index.js', import.meta.url));
console.log(
  `Core ESM entry: ${entry.length} bytes; gzip: ${gzipSync(entry).length} bytes (external zod excluded).`,
);

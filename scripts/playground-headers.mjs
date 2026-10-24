import { writeFile } from 'node:fs/promises';
import { securityHeaders } from '../apps/playground/security-headers.mjs';

const lines = Object.entries(securityHeaders()).map(([key, value]) => `  ${key}: ${value}`);
lines.push('  Strict-Transport-Security: max-age=31536000; includeSubDomains');
if (lines.some((line) => line.length > 2000)) throw new Error('Static header exceeds host limit.');
await writeFile(
  new URL('../apps/playground/out/_headers', import.meta.url),
  `/*\n${lines.join('\n')}\n`,
);
console.log('Wrote production security headers to apps/playground/out/_headers.');

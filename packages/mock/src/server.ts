import { serve } from '@hono/node-server';
import { createMockApp, type MockFailureStatus } from './routes.js';

const seed = process.env.MOCK_SEED;
const configuredFailure = Number(process.env.MOCK_FAIL_STATUS);
const options = {
  ...(seed ? { seed } : {}),
  latencyMs: Number(process.env.MOCK_LATENCY_MS ?? 0),
  ...([400, 403, 429, 500, 502, 503, 504].includes(configuredFailure)
    ? { failureStatus: configuredFailure as MockFailureStatus }
    : {}),
  log: ({
    method,
    path,
    status,
    durationMs,
  }: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
  }) => {
    console.info(`[gra-evat MOCK] ${method} ${path} ${status} ${durationMs}ms`);
  },
};
const app = createMockApp(options);
const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '127.0.0.1';
const server = serve({ fetch: app.fetch, port, hostname }, () => {
  console.info(
    `gra-evat MOCK listening at http://${hostname}:${port}. Signatures are FAKE. security_key=mock`,
  );
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close();
  });

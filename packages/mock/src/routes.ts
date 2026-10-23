import {
  CallbackSchema,
  CancellationSchema,
  DEFAULT_TIN_PATTERN,
  InventorySchema,
  NoteSchema,
  StatementOfAccountSchema,
  validateInvoice,
} from '@gra-evat/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { MockStore, MockStoreError } from './store.js';
import { receiptTimestamp, signMockInvoice } from './signing.js';

export type MockFailureStatus = 400 | 403 | 429 | 500 | 502 | 503 | 504;

export interface MockLogEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export interface MockOptions {
  /** Stable seed fixes both receipt signatures and timestamps. */
  seed?: string;
  /** Artificial latency, applied to every request. */
  latencyMs?: number;
  /** Reproducible failure injection. A ?fail= query overrides this option. */
  failureStatus?: MockFailureStatus;
  /** Fake key only. The mock never accepts or needs GRA credentials. */
  securityKey?: string;
  allowedOrigins?: string[];
  /** Logs exclude request bodies, headers and identifying URL segments. */
  log?: (entry: MockLogEntry) => void;
  /** Override the clock for reproducible tests. */
  now?: () => Date;
}

interface RuntimeSchema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };
}

function parse<T>(schema: RuntimeSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new MockStoreError(
      `Validation_error: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}

function forbiddenTimestamp(date: Date): string {
  return receiptTimestamp(date).replaceAll('/', '-');
}

/**
 * Create the browser-safe, in-memory Hono mock of the documented JSON API.
 * Every response carries X-Gra-Evat-Mock: true. All signatures are fake.
 * @example
 * const app = createMockApp({ seed: 'demo' });
 * const response = await app.request('/vsdc/api/v1/taxpayer/C0000000000-001/health', {
 *   headers: { security_key: 'mock' },
 * });
 * console.log(await response.json()); // { status: 'UP' }
 */
export function createMockApp(options: MockOptions = {}): Hono {
  const app = new Hono();
  const stores = new Map<string, MockStore>();
  let sequence = 0;
  const seed = options.seed ?? 'gra-evat';
  const now =
    options.now ?? (options.seed ? () => new Date('2026-01-01T12:00:00Z') : () => new Date());
  const securityKey = options.securityKey ?? 'mock';
  const latencyMs = options.latencyMs ?? 0;
  if (!Number.isSafeInteger(latencyMs) || latencyMs < 0 || latencyMs > 60_000) {
    throw new RangeError('latencyMs must be an integer from 0 to 60000');
  }
  const origins = options.allowedOrigins ?? ['http://localhost:3000', 'http://127.0.0.1:3000'];
  app.use(
    '*',
    cors({
      origin: (origin) => (origins.includes(origin) ? origin : undefined),
      allowHeaders: ['Content-Type', 'security_key'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      exposeHeaders: ['X-Gra-Evat-Mock'],
      maxAge: 600,
    }),
  );
  app.use('*', async (context, next) => {
    const started = Date.now();
    context.header('X-Gra-Evat-Mock', 'true');
    context.header('Cache-Control', 'no-store');
    if (latencyMs)
      await new Promise<void>((resolve, reject) => {
        const signal = context.req.raw.signal;
        const timeout = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, latencyMs);
        function abort(): void {
          clearTimeout(timeout);
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        }
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    if (context.req.raw.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const injected = context.req.query('fail');
    const failure = injected === undefined ? options.failureStatus : Number(injected);
    if (failure && [400, 403, 429, 500, 502, 503, 504].includes(failure)) {
      if (failure === 429) context.header('Retry-After', '1');
      const body = {
        timestamp: forbiddenTimestamp(now()),
        status: failure,
        error: 'MOCK_injected_failure',
      };
      context.res = context.json(body, failure as MockFailureStatus);
    } else if (context.req.header('security_key') !== securityKey) {
      context.res = context.json(
        { timestamp: forbiddenTimestamp(now()), status: 901, error: 'forbidden' },
        403,
      );
    } else {
      await next();
    }
    options.log?.({
      method: context.req.method,
      path: context.req.path
        .replace(/\/taxpayer\/[^/]+/, '/taxpayer/:taxpayerId')
        .replace(/\/identification\/(tin|nationalId)\/[^/]+/, '/identification/$1/:identifier'),
      status: context.res.status,
      durationMs: Date.now() - started,
    });
  });
  app.onError((error, context) => {
    const message =
      error instanceof MockStoreError
        ? error.message
        : error instanceof SyntaxError
          ? 'Malformed_JSON'
          : 'MOCK_internal_error';
    return context.json({ timestamp: forbiddenTimestamp(now()), status: 400, error: message }, 400);
  });
  app.notFound((context) =>
    context.json(
      { timestamp: forbiddenTimestamp(now()), status: 404, error: 'MOCK_endpoint_not_found' },
      404,
    ),
  );

  const prefix = '/vsdc/api/v1/taxpayer/:taxpayerId';
  function store(taxpayerId: string): MockStore {
    const existing = stores.get(taxpayerId);
    if (existing) return existing;
    const next = new MockStore();
    stores.set(taxpayerId, next);
    return next;
  }

  app.get(`${prefix}/health`, (context) => context.json({ status: 'UP' }));
  app.post(`${prefix}/invoice`, async (context) => {
    const parsed = validateInvoice(await context.req.json<unknown>());
    if (!parsed.ok) throw new MockStoreError(`Validation_error: ${parsed.error.message}`);
    const payload = parsed.data;
    const taxpayerId = context.req.param('taxpayerId');
    const storage = store(taxpayerId);
    const response = signMockInvoice(payload, taxpayerId, sequence + 1, seed, now());
    if (payload.flag === 'INVOICE' || payload.flag === 'PURCHASE')
      storage.create(payload, response);
    else storage.reverse(payload, response);
    sequence += 1;
    return context.json(response);
  });
  app.post(`${prefix}/cancellation`, async (context) => {
    const payload = parse(CancellationSchema, await context.req.json<unknown>());
    store(context.req.param('taxpayerId')).cancel(
      payload.invoiceNumber,
      payload.reference,
      payload.flag === 'PURCHASE_RETURN_CANCELATION',
      payload.totalAmount,
    );
    // ASSUMPTION: v8.2 provides no cancellation success example; this acknowledgement is a mock-only response.
    return context.json({ status: 'SUCCESS' });
  });
  app.post(`${prefix}/invoice/callback`, async (context) => {
    const payload = parse(CallbackSchema, await context.req.json<unknown>());
    return context.json(
      store(context.req.param('taxpayerId')).callback(
        payload.invoiceNumber,
        payload.flag,
        payload.reference,
      ),
    );
  });
  app.post(`${prefix}/inventory`, async (context) => {
    parse(InventorySchema, await context.req.json<unknown>());
    return context.json({ status: 'SUCCESS' });
  });
  app.post(`${prefix}/note`, async (context) => {
    const payload = parse(NoteSchema, await context.req.json<unknown>());
    const storage = store(context.req.param('taxpayerId'));
    payload.noteLines.forEach((line) => storage.requireInvoice(line.invoiceNumber));
    storage.reserve(`note:${payload.noteNumber}`);
    // ASSUMPTION: v8.2 provides no note success example; this acknowledgement is a mock-only response.
    return context.json({ status: 'SUCCESS' });
  });
  app.post(`${prefix}/statment_of_account`, async (context) => {
    const payload = parse(StatementOfAccountSchema, await context.req.json<unknown>());
    const storage = store(context.req.param('taxpayerId'));
    payload.groupInvoiceLines.forEach((line) => storage.requireInvoice(line.invoiceNumber));
    storage.reserve(`statement:${payload.groupReferenceId}`);
    // ASSUMPTION: v8.2 provides no account success example; this acknowledgement is a mock-only response.
    return context.json({ status: 'SUCCESS' });
  });
  app.get(`${prefix}/identification/tin/:tin`, (context) => {
    const tin = context.req.param('tin');
    if (!DEFAULT_TIN_PATTERN.test(tin)) throw new MockStoreError('Invalid_TIN_format');
    return context.json({
      status: 'SUCCESS',
      data: {
        tin,
        type: tin.startsWith('GHA-') ? 'P' : tin.slice(0, 1),
        name: 'MOCK TRADING LIMITED',
        sector: 'MOCK retail trade',
        address: 'MOCK address, Accra',
      },
    });
  });
  app.get(`${prefix}/identification/nationalId/:nationalId`, (context) => {
    if (!/^GHA-\d{9}-\d$/.test(context.req.param('nationalId')))
      throw new MockStoreError('Invalid_Ghana_Card_format');
    return context.json({
      status: 'SUCCESS',
      // ASSUMPTION: synthetic identities are fixed; this mock does not verify government records.
      data: {
        tin: 'C0000000000',
        type: 'C',
        name: 'MOCK TRADING LIMITED',
        sector: 'MOCK retail trade',
        address: 'MOCK address, Accra',
      },
    });
  });
  return app;
}

/**
 * Share all server routes and transaction rules with the hosted playground, without a server.
 * Create once per session to preserve prior invoices and refunds. AbortSignal is respected.
 * @example
 * import { createClient } from '@gra-evat/core';
 * import { createMockFetch } from '@gra-evat/mock';
 * const client = createClient({ baseUrl: 'https://mock.gra-evat.invalid',
 *   credentials: { securityKey: 'mock', taxpayerId: 'C0000000000-001' }, fetch: createMockFetch() });
 */
export function createMockFetch(options: MockOptions = {}): typeof fetch {
  const app = createMockApp(options);
  return async (input, init) => {
    const request = new Request(input, init);
    if (request.signal.aborted)
      throw request.signal.reason ?? new DOMException('Aborted', 'AbortError');
    let abort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(request.signal.reason ?? new DOMException('Aborted', 'AbortError'));
      request.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([app.fetch(request), aborted]);
    } finally {
      if (abort) request.signal.removeEventListener('abort', abort);
    }
  };
}

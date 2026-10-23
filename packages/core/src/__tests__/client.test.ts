import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, GraApiError, NetworkError, TimeoutError, ValidationError } from '../index';
import {
  cancellation,
  identification,
  inventory,
  note,
  receipt,
  sampleInvoice,
  statement,
} from './fixtures';

const credentials = { taxpayerId: 'C0000000000-001', securityKey: 'mock' };
function setup(
  fetcher: typeof fetch,
  options: { timeoutMs?: number; retries?: number; baseUrl?: string } = {},
) {
  return createClient({
    baseUrl: 'http://localhost:8787',
    credentials,
    fetch: fetcher,
    ...options,
  });
}
function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    ...(headers === undefined ? {} : { headers }),
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('portable HTTP client', () => {
  it('sends exact paths, authenticated header and JSON without adding identity fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(receipt));
    const gra = setup(fetcher);
    const invoice = sampleInvoice();
    expect(await gra.invoice(invoice)).toEqual({ ok: true, data: receipt });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:8787/vsdc/api/v1/taxpayer/C0000000000-001/invoice');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      security_key: 'mock',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual(invoice);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it('supports explicit API-prefix base URLs, trailing slashes and query failure injection', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ status: 'UP' }));
    const gra = setup(fetcher, { baseUrl: 'http://localhost:8787/vsdc/api/v1/taxpayer/?fail=500' });
    await gra.health();
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'http://localhost:8787/vsdc/api/v1/taxpayer/C0000000000-001/health?fail=500',
    );
    expect(fetcher.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
  it('uses global fetch by default and has a throwing variant', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(json({ status: 'UP' })));
    const gra = createClient({ baseUrl: 'https://example.invalid', credentials });
    expect(await gra.throwing.health()).toEqual({ status: 'UP' });
  });
  it('returns validation failures before network calls and enforces operation flags', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const gra = setup(fetcher);
    for (const method of [
      gra.invoice,
      gra.refund,
      gra.partialRefund,
      gra.purchase,
      gra.purchaseReturn,
      gra.cancelRefund,
      gra.cancelPurchaseReturn,
      gra.note,
      gra.statementOfAccount,
      gra.inventory,
      gra.callback,
    ]) {
      const result = await method({});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeInstanceOf(ValidationError);
    }
    expect((await gra.refund(sampleInvoice())).ok).toBe(false);
    expect((await gra.cancelPurchaseReturn(cancellation)).ok).toBe(false);
    expect((await gra.lookupTin(' C0000000000')).ok).toBe(false);
    expect((await gra.lookupGhanaCard('GHA-1')).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(gra.throwing.invoice({})).rejects.toBeInstanceOf(ValidationError);
  });
  it('covers every documented invoice operation and their throwing counterparts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(receipt));
    const gra = setup(fetcher);
    const invoice = sampleInvoice();
    const operations = [
      [gra.invoice, gra.throwing.invoice, 'INVOICE'],
      [gra.refund, gra.throwing.refund, 'REFUND'],
      [gra.partialRefund, gra.throwing.partialRefund, 'PARTIAL_REFUND'],
      [gra.purchase, gra.throwing.purchase, 'PURCHASE'],
      [gra.purchaseReturn, gra.throwing.purchaseReturn, 'PURCHASE_RETURN'],
    ] as const;
    for (const [method, throwing, flag] of operations) {
      const payload = { ...invoice, flag, reference: 'REF-1' };
      expect((await method(payload)).ok).toBe(true);
      expect(await throwing(payload)).toEqual(receipt);
    }
  });
  it('covers cancellation, note, statement, inventory and callback without inventing undocumented response types', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/invoice/callback')) return json(receipt);
      if (path.endsWith('/inventory')) return json({ status: 'SUCCESS' });
      return json({ undocumentedResponse: 42 });
    });
    const gra = setup(fetcher);
    expect(await gra.cancelRefund(cancellation)).toEqual({
      ok: true,
      data: { undocumentedResponse: 42 },
    });
    expect(await gra.throwing.cancelRefund(cancellation)).toEqual({ undocumentedResponse: 42 });
    expect(
      (await gra.cancelPurchaseReturn({ ...cancellation, flag: 'PURCHASE_RETURN_CANCELATION' })).ok,
    ).toBe(true);
    expect(
      await gra.throwing.cancelPurchaseReturn({
        ...cancellation,
        flag: 'PURCHASE_RETURN_CANCELATION',
      }),
    ).toEqual({ undocumentedResponse: 42 });
    expect((await gra.note(note)).ok).toBe(true);
    expect(await gra.throwing.note(note)).toEqual({ undocumentedResponse: 42 });
    expect((await gra.statementOfAccount(statement)).ok).toBe(true);
    expect(await gra.throwing.statementOfAccount(statement)).toEqual({ undocumentedResponse: 42 });
    expect(await gra.inventory(inventory)).toEqual({ ok: true, data: { status: 'SUCCESS' } });
    expect(await gra.throwing.inventory(inventory)).toEqual({ status: 'SUCCESS' });
    expect(
      await gra.callback({ invoiceNumber: 'INV-001', reference: '', flag: 'INVOICE' }),
    ).toEqual({ ok: true, data: receipt });
    expect(
      await gra.throwing.callback({ invoiceNumber: 'INV-001', reference: '', flag: 'INVOICE' }),
    ).toEqual(receipt);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/statment_of_account'))).toBe(
      true,
    );
  });
  it('validates identity lookup paths and configurable TIN policy', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(identification));
    const gra = setup(fetcher);
    expect(await gra.lookupTin('C0000000000')).toEqual({ ok: true, data: identification });
    expect(await gra.throwing.lookupTin('C0000000000')).toEqual(identification);
    expect(await gra.lookupGhanaCard('GHA-123456789-0')).toEqual({
      ok: true,
      data: identification,
    });
    expect(await gra.throwing.lookupGhanaCard('GHA-123456789-0')).toEqual(identification);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toContain(
      'http://localhost:8787/vsdc/api/v1/taxpayer/C0000000000-001/identification/tin/C0000000000',
    );
    const custom = createClient({
      baseUrl: 'http://localhost:8787',
      credentials,
      fetch: fetcher,
      validation: { tinPattern: /^TIN\d+$/g },
    });
    expect((await custom.lookupTin('TIN42')).ok).toBe(true);
  });
  it('returns documented error body and never retries ordinary 4xx', async () => {
    const body = { timestamp: '2026-01-01 00:00:00', status: 901, error: 'forbidden' };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(body, 403));
    const result = await setup(fetcher, { retries: 3 }).health();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ status: 403, code: 'forbidden', body });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains plain text error responses without requiring JSON', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('gateway unavailable', { status: 502 }));
    const result = await setup(fetcher).health();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        status: 502,
        code: 'HTTP_ERROR',
        body: 'gateway unavailable',
      });
  });
  it('rejects malformed success JSON and invalid success envelopes without retrying', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{broken'))
      .mockResolvedValueOnce(json({ status: 'DOWN' }));
    const gra = setup(fetcher, { retries: 2 });
    const malformed = await gra.health();
    const invalid = await gra.health();
    expect(malformed.ok).toBe(false);
    expect(invalid.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error).toMatchObject({ code: 'MALFORMED_JSON' });
    if (!invalid.ok) expect(invalid.error).toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('retries 5xx with exponential backoff and jitter until success', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ status: 'UP' }));
    const pending = setup(fetcher, { retries: 2 }).health();
    await vi.advanceTimersByTimeAsync(299);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(550);
    expect(await pending).toEqual({ ok: true, data: { status: 'UP' } });
    expect(fetcher).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });
  it('respects 429 Retry-After seconds', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json({ status: 'UP' }));
    const pending = setup(fetcher, { retries: 1 }).health();
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).ok).toBe(true);
  });
  it('respects Retry-After dates and falls back for malformed headers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': 'Thu, 01 Jan 2026 00:00:01 GMT' }))
      .mockResolvedValueOnce(json({}, 500, { 'Retry-After': 'invalid' }))
      .mockResolvedValueOnce(json({ status: 'UP' }));
    const pending = setup(fetcher, { retries: 2 }).health();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    expect((await pending).ok).toBe(true);
  });
  it('returns the final HTTP error after retry exhaustion', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => json({ error: 'temporarily_unavailable' }, 503));
    const pending = setup(fetcher, { retries: 2 }).health();
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(GraApiError);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('retries only network failures when enabled, retaining original cause at exhaustion', async () => {
    vi.useFakeTimers();
    const cause = new TypeError('fetch failed');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(cause);
    const pending = setup(fetcher, { retries: 2 }).health();
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({ name: 'NetworkError', originalCause: cause });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await setup(vi.fn<typeof fetch>().mockRejectedValue(cause)).health()).ok).toBe(false);
  });
  it('aborts a stalled fetch at the timeout and does not blindly retry the POST', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      signal = init?.signal;
      return new Promise(() => undefined);
    });
    const pending = setup(fetcher, { timeoutMs: 50, retries: 3 }).invoice(sampleInvoice());
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(TimeoutError);
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('applies timeout to a response whose body never completes', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const pending = setup(fetcher, { timeoutMs: 20 }).health();
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(TimeoutError);
  });
  it('validates unsafe client options and missing runtime fetch', () => {
    const cases = [
      { baseUrl: 'relative' },
      { baseUrl: 'ftp://example.com' },
      { baseUrl: 'https://user:password@example.com' },
      { credentials: { ...credentials, securityKey: '' } },
      { credentials: { ...credentials, taxpayerId: '../escape' } },
      { timeoutMs: 0 },
      { timeoutMs: Number.NaN },
      { timeoutMs: 1.5 },
      { timeoutMs: 2147483648 },
      { retries: -1 },
      { retries: 1.5 },
      { retries: 11 },
    ];
    for (const override of cases)
      expect(() =>
        createClient({ baseUrl: 'http://localhost:8787', credentials, ...override }),
      ).toThrow(ValidationError);
    vi.stubGlobal('fetch', undefined);
    expect(() => createClient({ baseUrl: 'http://localhost:8787', credentials })).toThrow('fetch');
  });
  it('exports typed error classes with practical metadata', () => {
    expect(new NetworkError('offline').name).toBe('NetworkError');
    expect(new TimeoutError(10).timeoutMs).toBe(10);
    expect(new GraApiError(400, 'bad_request', {}).message).toContain('400');
  });
});

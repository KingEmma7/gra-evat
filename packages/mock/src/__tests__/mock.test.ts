import { createClient, createInvoice, parseMoney, type Invoice } from '@gra-evat/core';
import { describe, expect, it, vi } from 'vitest';
import { createSampleInvoice } from '../fixtures.js';
import { createMockApp, createMockFetch } from '../routes.js';
import { receiptTimestamp } from '../signing.js';

const taxpayer = 'C0000000000-001';
const prefix = `/vsdc/api/v1/taxpayer/${taxpayer}`;
const headers = { 'content-type': 'application/json', security_key: 'mock' };
const clock = () => new Date('2026-02-01T09:30:00Z');

function refund(
  original: Invoice,
  quantity: string,
  reference: string,
  flag: Invoice['flag'] = 'PARTIAL_REFUND',
  discountAmount = '0.00',
): Invoice {
  const line = original.items[0];
  if (!line) throw new Error('Fixture needs an item');
  return createInvoice({
    invoiceNumber: original.invoiceNumber,
    transactionDate: '2026-02-01',
    userName: original.userName,
    businessPartnerName: original.businessPartnerName,
    businessPartnerTin: original.businessPartnerTin,
    calculationType: original.calculationType,
    currency: original.currency,
    exchangeRate: original.exchangeRate,
    flag,
    reference,
    items: [
      {
        itemCode: line.itemCode,
        description: line.description,
        quantity,
        unitPrice: parseMoney(String(line.unitPrice)),
        itemCategory: line.itemCategory === 'EXM' ? 'EXM' : '',
        discountAmount: parseMoney(discountAmount),
      },
    ],
  });
}

function cancellation(original: Invoice, reversed: Invoice, flag = 'REFUND_CANCELATION') {
  return {
    invoiceNumber: original.invoiceNumber,
    reference: reversed.reference,
    userName: 'Mock cashier',
    flag,
    transactionDate: '2026-02-01T09:30:00Z',
    totalAmount: reversed.totalAmount,
  };
}

describe('documented mock HTTP contract', () => {
  it('health, authentication, mock labels and sanitized logging', async () => {
    const log = vi.fn();
    const app = createMockApp({ seed: 'test', now: clock, log });
    const forbidden = await app.request(`${prefix}/health`);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      timestamp: '2026-02-01 09:30:00',
      status: 901,
      error: 'forbidden',
    });
    const response = await app.request(`${prefix}/health`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'UP' });
    expect(response.headers.get('x-gra-evat-mock')).toBe('true');
    expect(log.mock.calls[0]?.[0]).toMatchObject({
      method: 'GET',
      path: '/vsdc/api/v1/taxpayer/:taxpayerId/health',
      status: 403,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(taxpayer);
    expect(JSON.stringify(log.mock.calls)).not.toContain('security_key');
  });

  it('issues exact response keys and fake signatures, preserving UTC response format', async () => {
    const app = createMockApp({ seed: 'test', now: clock });
    const response = await app.request(`${prefix}/invoice`, {
      method: 'POST',
      headers,
      body: JSON.stringify(createSampleInvoice()),
    });
    const body = (await response.json()) as {
      response: {
        distributor_tin: string;
        message: Record<string, string>;
        qr_code: string;
        status: string;
      };
    };
    expect(response.status).toBe(200);
    expect(body.response.distributor_tin).toBe('C0000000000');
    expect(body.response.status).toBe('SUCCESS');
    expect(body.response.message).toMatchObject({
      num: 'MOCK-INV-001',
      flag: 'INVOICE',
      ysdcitems: '1',
      ysdcmrctim: '2026/02/01 09:30:00',
    });
    expect(body.response.message.ysdcregsig).toMatch(/^MOCK-.*-FAKE$/);
    expect(body.response.qr_code).toContain('https://mock.gra-evat.invalid/receipt?mock=true');
    expect(Object.keys(body.response.message).sort()).toEqual(
      [
        'flag',
        'num',
        'ysdcid',
        'ysdcintdata',
        'ysdcitems',
        'ysdcmrc',
        'ysdcmrctim',
        'ysdcrecnum',
        'ysdcregsig',
        'ysdctime',
      ].sort(),
    );
  });

  it('reproduces receipt signatures and timestamps for a seed', async () => {
    const invoice = createSampleInvoice();
    const first = createMockApp({ seed: 'repeatable' });
    const second = createMockApp({ seed: 'repeatable' });
    const request = { method: 'POST', headers, body: JSON.stringify(invoice) };
    expect(await (await first.request(`${prefix}/invoice`, request)).json()).toEqual(
      await (await second.request(`${prefix}/invoice`, request)).json(),
    );
  });

  it('rejects duplicate invoices with the documented 400 error style', async () => {
    const app = createMockApp({ seed: 'test', now: clock });
    const request = { method: 'POST', headers, body: JSON.stringify(createSampleInvoice()) };
    await app.request(`${prefix}/invoice`, request);
    const duplicate = await app.request(`${prefix}/invoice`, request);
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toEqual({
      timestamp: '2026-02-01 09:30:00',
      status: 400,
      error: 'Invoice_MOCK-INV-001_already_signed',
    });
  });

  it('isolates transaction identifiers by taxpayer', async () => {
    const app = createMockApp();
    const request = { method: 'POST', headers, body: JSON.stringify(createSampleInvoice()) };
    expect((await app.request(`${prefix}/invoice`, request)).status).toBe(200);
    expect(
      (await app.request('/vsdc/api/v1/taxpayer/C0000000001-002/invoice', request)).status,
    ).toBe(200);
  });

  it('returns readable all-field errors and malformed JSON failures', async () => {
    const app = createMockApp();
    const invalid = await app.request(`${prefix}/invoice`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ flag: 'invoice' }),
    });
    expect(invalid.status).toBe(400);
    const body = (await invalid.json()) as { error: string };
    expect(body.error).toContain('flag');
    expect(body.error).toContain('currency');
    const malformed = await app.request(`${prefix}/invoice`, {
      method: 'POST',
      headers,
      body: '{',
    });
    expect(await malformed.json()).toMatchObject({ status: 400, error: 'Malformed_JSON' });
  });

  it('supports failure and latency injection, including Retry-After', async () => {
    const app = createMockApp({ seed: 'test', latencyMs: 5 });
    const started = Date.now();
    const response = await app.request(`${prefix}/health?fail=429`, { headers });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(Date.now() - started).toBeGreaterThanOrEqual(4);
    expect((await app.request(`${prefix}/health?fail=500`, { headers })).status).toBe(500);
    expect(
      (await createMockApp({ failureStatus: 503 }).request(`${prefix}/health`, { headers })).status,
    ).toBe(503);
    expect((await app.request(`${prefix}/health?fail=200`, { headers })).status).toBe(200);
    expect(() => createMockApp({ latencyMs: -1 })).toThrow(RangeError);
    expect(() => createMockApp({ latencyMs: 60_001 })).toThrow(RangeError);
  });

  it('supports local CORS preflight without allowing arbitrary origins', async () => {
    const app = createMockApp();
    const preflight = await app.request(`${prefix}/invoice`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,security_key',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    const foreign = await app.request(`${prefix}/health`, {
      headers: { ...headers, origin: 'https://untrusted.invalid' },
    });
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns mock-only 404 for paths outside the contract', async () => {
    const response = await createMockApp().request(`${prefix}/made-up`, { headers });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'MOCK_endpoint_not_found' });
  });

  it('returns synthetic identification records and accepts validated inventory', async () => {
    const app = createMockApp();
    const tin = await app.request(`${prefix}/identification/tin/C0000000002`, { headers });
    expect(await tin.json()).toMatchObject({
      status: 'SUCCESS',
      data: { tin: 'C0000000002', name: 'MOCK TRADING LIMITED' },
    });
    const card = await app.request(`${prefix}/identification/nationalId/GHA-123456789-0`, {
      headers,
    });
    expect(await card.json()).toMatchObject({ status: 'SUCCESS', data: { tin: 'C0000000000' } });
    const inventory = {
      inventories: [
        {
          code: 'SKU-1',
          description: 'Notebook',
          quantity: 3,
          batchCode: 'B-1',
          unitPrice: 100,
          expiryDate: '2027-01-01',
        },
      ],
      inventoryDate: '2026-01-01',
    };
    expect(
      await (
        await app.request(`${prefix}/inventory`, {
          method: 'POST',
          headers,
          body: JSON.stringify(inventory),
        })
      ).json(),
    ).toEqual({ status: 'SUCCESS' });
    expect(
      (await app.request(`${prefix}/inventory`, { method: 'POST', headers, body: '{}' })).status,
    ).toBe(400);
  });

  it('retrieves the original signed response by documented callback', async () => {
    const app = createMockApp();
    const invoice = createSampleInvoice();
    const original = await (
      await app.request(`${prefix}/invoice`, {
        method: 'POST',
        headers,
        body: JSON.stringify(invoice),
      })
    ).json();
    const callback = { invoiceNumber: invoice.invoiceNumber, reference: '', flag: 'INVOICE' };
    expect(
      await (
        await app.request(`${prefix}/invoice/callback`, {
          method: 'POST',
          headers,
          body: JSON.stringify(callback),
        })
      ).json(),
    ).toEqual(original);
    expect(
      (
        await app.request(`${prefix}/invoice/callback`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...callback, invoiceNumber: 'missing' }),
        })
      ).status,
    ).toBe(400);
  });

  it('accepts documented credit notes and statement paths only for known invoices', async () => {
    const app = createMockApp();
    const invoice = createSampleInvoice();
    await app.request(`${prefix}/invoice`, {
      method: 'POST',
      headers,
      body: JSON.stringify(invoice),
    });
    const note = {
      noteNumber: 'CN-1',
      currency: 'GHS',
      exchangeRate: 1,
      noteAmount: 100,
      calculationType: 'EXCLUSIVE',
      businessPartnerName: 'Mock cash customer',
      businessPartnerTin: 'C0000000000',
      userName: 'Mock cashier',
      flag: 'CREDIT_NOTE',
      groupReferenceId: '',
      transactionDate: '2026-02-01',
      remarks: 'CN',
      noteLineFlag: 'INVOICE',
      noteLines: [
        { invoiceNumber: invoice.invoiceNumber, invoiceDate: '2026-01-01', invoiceAmount: 4500 },
      ],
    };
    const post = (path: string, body: unknown) =>
      app.request(`${prefix}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(await (await post('note', note)).json()).toEqual({ status: 'SUCCESS' });
    expect((await post('note', note)).status).toBe(400);
    const groupLine = {
      currency: 'GHS',
      exchangeRate: 1,
      calculationType: 'EXCLUSIVE',
      invoiceNumber: invoice.invoiceNumber,
      flag: 'INVOICE',
      invoiceVat: 675,
      invoiceAmount: 4500,
      invoiceLevies: 225,
      transactionDate: '2026-01-01',
    };
    const statement = {
      currency: 'GHS',
      exchangeRate: 1,
      totalVat: 675,
      totalAmount: 4500,
      totalLevies: 225,
      userName: 'Mock cashier',
      businessPartnerName: 'Mock cash customer',
      businessPartnerTin: 'C0000000000',
      groupReferenceId: 'GROUP-1',
      transactionDate: '2026-02-01',
      calculationType: 'EXCLUSIVE',
      groupInvoiceLines: [groupLine],
    };
    expect(await (await post('statment_of_account', statement)).json()).toEqual({
      status: 'SUCCESS',
    });
    expect((await post('statement_of_account', statement)).status).toBe(404);
    expect(
      (
        await post('note', {
          ...note,
          noteNumber: 'CN-2',
          noteLines: [{ ...note.noteLines[0], invoiceNumber: 'missing' }],
        })
      ).status,
    ).toBe(400);
  });
});

describe('refund accounting', () => {
  function setup(invoice = createSampleInvoice()) {
    const app = createMockApp({ seed: 'refunds' });
    const post = (path: string, body: unknown) =>
      app.request(`${prefix}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { app, invoice, post };
  }

  it('requires a prior invoice and rejects quantities over the original', async () => {
    const { invoice, post } = setup();
    const partial = refund(invoice, '46', 'RF-1');
    expect((await post('invoice', partial)).status).toBe(400);
    await post('invoice', invoice);
    expect(await (await post('invoice', partial)).json()).toMatchObject({
      error: 'Refund_quantity_ABT301_exceeds_original',
    });
  });

  it('aggregates exact fractional quantities and can cancel a partial refund', async () => {
    const { invoice, post } = setup();
    await post('invoice', invoice);
    const first = refund(invoice, '22.5', 'RF-1');
    const receipt = await (await post('invoice', first)).json();
    expect(receipt).toMatchObject({ response: { message: { num: 'RF-1', flag: 'REFUND' } } });
    expect((await post('invoice', refund(invoice, '22.500001', 'RF-2'))).status).toBe(400);
    expect((await post('cancellation', cancellation(invoice, first))).status).toBe(200);
    expect((await post('invoice', refund(invoice, '45', 'RF-3', 'REFUND'))).status).toBe(200);
    expect((await post('cancellation', cancellation(invoice, first))).status).toBe(400);
  });

  it('blocks refunds of a cancelled invoice and restores it on refund cancellation', async () => {
    const { invoice, post } = setup();
    await post('invoice', invoice);
    const full = refund(invoice, '45', 'RF-FULL', 'REFUND');
    expect((await post('invoice', full)).status).toBe(200);
    expect(await (await post('invoice', refund(invoice, '1', 'RF-AGAIN'))).json()).toMatchObject({
      error: 'Original_invoice_already_cancelled',
    });
    expect((await post('cancellation', cancellation(invoice, full))).status).toBe(200);
    expect((await post('invoice', refund(invoice, '1', 'RF-RESTORED'))).status).toBe(200);
  });

  it('requires full refund to reverse every remaining unit', async () => {
    const { invoice, post } = setup();
    await post('invoice', invoice);
    expect(
      await (await post('invoice', refund(invoice, '1', 'RF-SHORT', 'REFUND'))).json(),
    ).toMatchObject({ error: 'Full_refund_must_reverse_all_remaining_items' });
    expect((await post('invoice', refund(invoice, '10', 'RF-PART'))).status).toBe(200);
    expect((await post('invoice', refund(invoice, '35', 'RF-REST', 'REFUND'))).status).toBe(200);
  });

  it('does not allow duplicate refund references', async () => {
    const { invoice, post } = setup();
    await post('invoice', invoice);
    const partial = refund(invoice, '1', 'RF-1');
    expect((await post('invoice', partial)).status).toBe(200);
    expect(await (await post('invoice', partial)).json()).toMatchObject({
      error: 'Refund_reference_already_used',
    });
  });

  it('rejects split tax rounding that would over-credit a pesewa, without closing the invoice', async () => {
    const invoice = createInvoice({
      invoiceNumber: 'TINY-TAX-OVER',
      transactionDate: '2026-01-01',
      userName: 'Mock cashier',
      businessPartnerName: 'Mock customer',
      businessPartnerTin: 'C0000000000',
      calculationType: 'EXCLUSIVE',
      items: [
        {
          itemCode: 'TINY',
          description: 'Tiny taxable unit',
          quantity: '8',
          unitPrice: parseMoney('0.01'),
        },
      ],
    });
    const { post } = setup(invoice);
    await post('invoice', invoice);
    const first = refund(invoice, '4', 'RF-FIRST');
    expect((await post('invoice', first)).status).toBe(200);
    const excessive = await post('invoice', refund(invoice, '4', 'RF-LAST', 'REFUND'));
    expect(excessive.status).toBe(400);
    expect(await excessive.json()).toMatchObject({
      error: 'Refund_payable_exceeds_original_after_rounding',
    });
    expect((await post('cancellation', cancellation(invoice, first))).status).toBe(200);
    expect((await post('invoice', refund(invoice, '8', 'RF-CONSOLIDATED', 'REFUND'))).status).toBe(
      200,
    );
  });

  it('rejects fully reversed quantities when split tax rounding would under-credit the original', async () => {
    const invoice = createInvoice({
      invoiceNumber: 'TINY-TAX-UNDER',
      transactionDate: '2026-01-01',
      userName: 'Mock cashier',
      businessPartnerName: 'Mock customer',
      businessPartnerTin: 'C0000000000',
      calculationType: 'EXCLUSIVE',
      items: [
        {
          itemCode: 'TINY',
          description: 'Tiny taxable unit',
          quantity: '5',
          unitPrice: parseMoney('0.01'),
        },
      ],
    });
    const { post } = setup(invoice);
    await post('invoice', invoice);
    const first = refund(invoice, '2', 'RF-FIRST');
    expect((await post('invoice', first)).status).toBe(200);
    const incomplete = await post('invoice', refund(invoice, '3', 'RF-LAST'));
    expect(incomplete.status).toBe(400);
    expect(await incomplete.json()).toMatchObject({
      error: 'Refund_rounding_requires_cancelling_and_consolidating_prior_refunds',
    });
    expect((await post('cancellation', cancellation(invoice, first))).status).toBe(200);
    expect((await post('invoice', refund(invoice, '5', 'RF-CONSOLIDATED', 'REFUND'))).status).toBe(
      200,
    );
  });

  it('caps cumulative fractional refund discounts at the original discount', async () => {
    const invoice = createInvoice({
      invoiceNumber: 'TINY-DISCOUNT-OVER',
      transactionDate: '2026-01-01',
      userName: 'Mock cashier',
      businessPartnerName: 'Mock customer',
      businessPartnerTin: 'C0000000000',
      calculationType: 'EXCLUSIVE',
      items: [
        {
          itemCode: 'TINY',
          description: 'Discounted exempt unit',
          quantity: '3',
          unitPrice: parseMoney('1.00'),
          discountAmount: parseMoney('0.01'),
          itemCategory: 'EXM',
        },
      ],
    });
    const { post } = setup(invoice);
    await post('invoice', invoice);
    const first = refund(invoice, '1.5', 'RF-FIRST', 'PARTIAL_REFUND', '0.01');
    expect((await post('invoice', first)).status).toBe(200);
    const excessive = await post(
      'invoice',
      refund(invoice, '1.5', 'RF-LAST', 'PARTIAL_REFUND', '0.01'),
    );
    expect(excessive.status).toBe(400);
    expect(await excessive.json()).toMatchObject({
      error: 'Refund_discountAmount_exceeds_original_after_rounding',
    });
    expect((await post('cancellation', cancellation(invoice, first))).status).toBe(200);
    expect(
      (await post('invoice', refund(invoice, '3', 'RF-CONSOLIDATED', 'REFUND', '0.01'))).status,
    ).toBe(200);
  });

  it('does not let rounding down a discount increase total refund credit', async () => {
    const invoice = createInvoice({
      invoiceNumber: 'TINY-DISCOUNT-UNDER',
      transactionDate: '2026-01-01',
      userName: 'Mock cashier',
      businessPartnerName: 'Mock customer',
      businessPartnerTin: 'C0000000000',
      calculationType: 'INCLUSIVE',
      items: [
        {
          itemCode: 'TINY',
          description: 'Discounted exempt unit',
          quantity: '3',
          unitPrice: parseMoney('1.00'),
          discountAmount: parseMoney('0.01'),
          itemCategory: 'EXM',
        },
      ],
    });
    const { post } = setup(invoice);
    await post('invoice', invoice);
    expect((await post('invoice', refund(invoice, '1', 'RF-FIRST'))).status).toBe(200);
    expect((await post('invoice', refund(invoice, '1', 'RF-SECOND'))).status).toBe(200);
    const excessive = await post('invoice', refund(invoice, '1', 'RF-LAST'));
    expect(excessive.status).toBe(400);
    expect(await excessive.json()).toMatchObject({
      error: 'Refund_payable_exceeds_original_after_rounding',
    });
  });

  it('protects original price, currency, category and customer', async () => {
    const { invoice, post } = setup();
    await post('invoice', invoice);
    const partial = refund(invoice, '1', 'RF-PRICE');
    const line = partial.items[0];
    if (!line) throw new Error('Fixture line required');
    const repriced = createInvoice({
      invoiceNumber: invoice.invoiceNumber,
      transactionDate: '2026-02-01',
      userName: invoice.userName,
      businessPartnerName: invoice.businessPartnerName,
      businessPartnerTin: invoice.businessPartnerTin,
      calculationType: 'EXCLUSIVE',
      flag: 'PARTIAL_REFUND',
      reference: 'RF-PRICE',
      items: [
        {
          itemCode: line.itemCode,
          description: line.description,
          quantity: 1,
          unitPrice: parseMoney('200'),
        },
      ],
    });
    expect(await (await post('invoice', repriced)).json()).toMatchObject({
      error: 'Refund_item_ABT301_must_match_original',
    });
    expect((await post('invoice', { ...partial, currency: 'USD' })).status).toBe(400);
    expect((await post('invoice', { ...partial, businessPartnerTin: 'C0000000001' })).status).toBe(
      400,
    );
  });

  it('rejects cancellation of missing refunds or with wrong amounts', async () => {
    const { invoice, post } = setup();
    await post('invoice', invoice);
    const partial = refund(invoice, '1', 'RF-1');
    expect((await post('cancellation', cancellation(invoice, partial))).status).toBe(400);
    await post('invoice', partial);
    expect(
      (await post('cancellation', { ...cancellation(invoice, partial), totalAmount: 99 })).status,
    ).toBe(400);
    expect(
      (await post('cancellation', cancellation(invoice, partial, 'PURCHASE_RETURN_CANCELATION')))
        .status,
    ).toBe(400);
  });

  it('supports purchase return and its cancellation without signatures or QR', async () => {
    const purchase = { ...createSampleInvoice('BILL-1'), flag: 'PURCHASE' as const };
    const { post } = setup(purchase);
    const response = await (await post('invoice', purchase)).json();
    expect(response).toMatchObject({
      response: { message: { flag: 'PURCHASE', ysdcintdata: '', ysdcregsig: '' }, qr_code: '' },
    });
    expect((await post('invoice', refund(purchase, '1', 'WRONG-TYPE'))).status).toBe(400);
    const returned = refund(purchase, '45', 'PR-1', 'PURCHASE_RETURN');
    expect((await post('invoice', returned)).status).toBe(200);
    expect(
      (await post('cancellation', cancellation(purchase, returned, 'PURCHASE_RETURN_CANCELATION')))
        .status,
    ).toBe(200);
  });

  it('retrieves partial refund with its reference and normalized response flag', async () => {
    const { invoice, post } = setup();
    await post('invoice', invoice);
    const partial = refund(invoice, '1', 'RF-1');
    const receipt = await (await post('invoice', partial)).json();
    expect(
      await (
        await post('invoice/callback', {
          invoiceNumber: invoice.invoiceNumber,
          reference: 'RF-1',
          flag: 'REFUND',
        })
      ).json(),
    ).toEqual(receipt);
    expect(
      (
        await post('invoice/callback', {
          invoiceNumber: invoice.invoiceNumber,
          reference: 'RF-1',
          flag: 'PURCHASE_RETURN',
        })
      ).status,
    ).toBe(400);
  });
});

describe('hosted playground transport', () => {
  it('uses the same mock logic through an injected fetch and preserves state', async () => {
    const client = createClient({
      baseUrl: 'https://mock.gra-evat.invalid',
      credentials: { securityKey: 'mock', taxpayerId: taxpayer },
      fetch: createMockFetch({ seed: 'browser' }),
    });
    expect(await client.health()).toEqual({ ok: true, data: { status: 'UP' } });
    const invoice = createSampleInvoice();
    expect((await client.invoice(invoice)).ok).toBe(true);
    expect((await client.partialRefund(refund(invoice, '1', 'RF-BROWSER'))).ok).toBe(true);
    expect((await client.invoice(invoice)).ok).toBe(false);
  });

  it('accepts Request input and aborts before or during latency without committing', async () => {
    const transport = createMockFetch({ latencyMs: 20 });
    const immediate = new AbortController();
    immediate.abort(new Error('Stopped'));
    await expect(
      transport(`https://mock.invalid${prefix}/health`, { headers, signal: immediate.signal }),
    ).rejects.toThrow('Stopped');
    const controller = new AbortController();
    const pending = transport(
      new Request(`https://mock.invalid${prefix}/invoice`, {
        method: 'POST',
        headers,
        body: JSON.stringify(createSampleInvoice()),
        signal: controller.signal,
      }),
    );
    controller.abort(new Error('Stopped in flight'));
    await expect(pending).rejects.toThrow('Stopped in flight');
    const notStored = await transport(`https://mock.invalid${prefix}/invoice/callback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ invoiceNumber: 'MOCK-INV-001', reference: '', flag: 'INVOICE' }),
    });
    expect(notStored.status).toBe(400);
  });

  it('formats timestamps without the host timezone', () => {
    expect(receiptTimestamp(new Date('2026-02-01T11:00:00+02:00'))).toBe('2026/02/01 09:00:00');
  });
});

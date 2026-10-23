import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createInvoice,
  guardIdentity,
  parseMoney,
  pesewas,
  schemaIssues,
  TransactionDateSchema,
  validateInvoice,
  validateSchema,
  ValidationError,
  type BusinessIdentity,
  type Invoice,
} from '../index';
import { sampleInvoice } from './fixtures';

function issuePaths(invoice: unknown): string[] {
  const result = validateInvoice(invoice);
  if (result.ok) throw new Error('Expected validation failure');
  return result.error.issues.map((issue) => issue.path);
}

describe('exact wire validation', () => {
  it('accepts the documented 2026 example with C omitted and preserves date/decimal strings', () => {
    const invoice = sampleInvoice();
    delete invoice.items[0]?.levyAmountC;
    expect(validateInvoice(invoice)).toEqual({ ok: true, data: invoice });
    expect(invoice.transactionDate).toBe('2026-01-01');
    expect(invoice.totalAmount).toBe('4500.00');
    expect(invoice.totalVat).toBe('675.00');
    expect(invoice.totalLevy).toBe('225.00');
  });
  it('collects all missing and wrong-cased required fields in one pass', () => {
    const result = validateInvoice({
      currency: 'ghs',
      flag: 'invoice',
      calculationType: 'inclusive',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.issues.length).toBeGreaterThan(10);
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'flag',
          received: 'invoice',
          hint: expect.stringContaining('case-sensitive'),
        }),
      ]),
    );
    expect(result.error.message).toContain('invoiceNumber');
  });
  it('includes nested paths, expected values and fix hints', () => {
    const invoice = sampleInvoice();
    const result = validateInvoice({
      ...invoice,
      items: [{ ...invoice.items[0], quantity: -1, description: '' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['items.0.quantity', 'items.0.description']),
    );
    expect(result.error.issues.every((issue) => issue.expected && issue.hint)).toBe(true);
  });
  it('rejects undocumented fields with an exact removal hint', () => {
    const result = validateInvoice({ ...sampleInvoice(), invented: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues[0]?.hint).toBe('Remove undocumented fields: invented');
  });
  it.each([' C0000000000', 'C0000000000 ', 'C000', 'C00000000000', 'c0000000000'])(
    'rejects invalid TIN %s',
    (businessPartnerTin) => {
      expect(issuePaths({ ...sampleInvoice(), businessPartnerTin })).toContain(
        'businessPartnerTin',
      );
    },
  );
  it('accepts a Ghana Card and an explicitly configured alternative TIN policy', () => {
    expect(validateInvoice({ ...sampleInvoice(), businessPartnerTin: 'GHA-123456789-0' }).ok).toBe(
      true,
    );
    expect(
      validateInvoice(
        { ...sampleInvoice(), businessPartnerTin: 'TIN42' },
        { tinPattern: /^TIN\d+$/g },
      ).ok,
    ).toBe(true);
  });
  it('requires an explicit partner name and TIN instead of inventing an empty customer', () => {
    expect(
      issuePaths({ ...sampleInvoice(), businessPartnerName: '', businessPartnerTin: '' }),
    ).toEqual(expect.arrayContaining(['businessPartnerName', 'businessPartnerTin']));
  });
  it('supports the listed non-GHS currencies and enforces the GHS rate', () => {
    expect(validateInvoice({ ...sampleInvoice(), currency: 'USD', exchangeRate: '12.50' }).ok).toBe(
      true,
    );
    expect(issuePaths({ ...sampleInvoice(), currency: 'NGN' })).toContain('currency');
    expect(issuePaths({ ...sampleInvoice(), exchangeRate: '2' })).toContain('exchangeRate');
    expect(issuePaths({ ...sampleInvoice(), exchangeRate: '9'.repeat(1000) })).toContain(
      'exchangeRate',
    );
  });
  it('checks all money reconciliation and COVID levy removal', () => {
    const invoice = sampleInvoice();
    const item = invoice.items[0];
    const result = issuePaths({
      ...invoice,
      totalAmount: 1,
      totalLevy: 1,
      totalVat: 1,
      discountAmount: 1,
      totalExciseAmount: 1,
      items: [
        { ...item, levyAmountA: 1, levyAmountB: 1, levyAmountC: 1, levyAmountD: 1, levyAmountE: 1 },
      ],
    });
    expect(result).toEqual(
      expect.arrayContaining([
        'totalAmount',
        'totalLevy',
        'totalVat',
        'discountAmount',
        'totalExciseAmount',
        'items.0.levyAmountA',
        'items.0.levyAmountB',
        'items.0.levyAmountC',
        'items.0.levyAmountD',
        'items.0.levyAmountE',
      ]),
    );
  });
  it('reports duplicate codes and excessive discounts', () => {
    const invoice = sampleInvoice();
    expect(issuePaths({ ...invoice, items: [...invoice.items, ...invoice.items] })).toContain(
      'items.1.itemCode',
    );
    expect(
      issuePaths({ ...invoice, items: [{ ...invoice.items[0], discountAmount: 999999 }] }),
    ).toContain('items.0.discountAmount');
  });
  it('requires refund references but keeps original invoice numbers', () => {
    expect(issuePaths({ ...sampleInvoice(), flag: 'REFUND' })).toContain('reference');
    expect(validateInvoice({ ...sampleInvoice(), flag: 'REFUND', reference: 'REF-001' }).ok).toBe(
      true,
    );
    expect(
      validateInvoice({ ...sampleInvoice(), flag: 'PARTIAL_REFUND', reference: 'REF-002' }).ok,
    ).toBe(true);
  });
  it('rejects zero, negative and unsafe quantities and money', () => {
    const invoice = sampleInvoice();
    expect(issuePaths({ ...invoice, items: [{ ...invoice.items[0], quantity: 0 }] })).toContain(
      'items.0.quantity',
    );
    expect(
      issuePaths({ ...invoice, items: [{ ...invoice.items[0], unitPrice: '90071992547409.92' }] }),
    ).toContain('items.0');
    expect(issuePaths({ ...invoice, totalAmount: '90071992547409.92' })).toContain('totalAmount');
    expect(issuePaths({ ...invoice, items: [] })).toContain('items');
    expect(
      issuePaths({ ...invoice, items: Array.from({ length: 1001 }, () => invoice.items[0]) }),
    ).toContain('items');
  });
  it('accepts 1000 distinct lines and catches total overflow', () => {
    const input = {
      invoiceNumber: 'MAX-1',
      transactionDate: '2026-01-01',
      userName: 'Kofi',
      businessPartnerName: 'Cash customer',
      businessPartnerTin: 'C0000000000',
      calculationType: 'EXCLUSIVE' as const,
      items: Array.from({ length: 1000 }, (_, i) => ({
        itemCode: `SKU-${i}`,
        description: 'Item',
        quantity: 1,
        unitPrice: pesewas(100),
      })),
    };
    expect(createInvoice(input).items.length).toBe(1000);
    expect(() => createInvoice({ ...input, items: [] })).toThrow(ValidationError);
    expect(() => createInvoice({ ...input, transactionDate: '2025-12-31' })).toThrow('2026-01-01');
    expect(() =>
      createInvoice({
        ...input,
        items: [
          {
            itemCode: 'SKU-1',
            description: 'Item',
            quantity: 1,
            unitPrice: pesewas(Number.MAX_SAFE_INTEGER),
          },
        ],
      }),
    ).toThrow('safe integer');
  });
  it('keeps specialized/historical raw payloads available without claiming verified calculator rules', () => {
    const invoice = sampleInvoice();
    expect(
      validateInvoice({ ...invoice, discountType: 'SELECTIVE', discountAmount: 15, totalVat: 0 })
        .ok,
    ).toBe(true);
    expect(
      validateInvoice({ ...invoice, transactionDate: '2023-07-24T08:43:28Z', totalVat: 123 }).ok,
    ).toBe(true);
    expect(
      validateInvoice({
        ...invoice,
        totalVat: 123,
        items: [{ ...invoice.items[0], itemCategory: 'CST' }],
      }).ok,
    ).toBe(true);
  });
  it('still validates standard line levies when a specialized line shares the invoice', () => {
    const invoice = sampleInvoice();
    const paths = issuePaths({
      ...invoice,
      totalAmount: 9000,
      totalLevy: 338.5,
      items: [
        { ...invoice.items[0], levyAmountA: 1 },
        { ...invoice.items[0], itemCode: 'CST-1', itemCategory: 'CST' },
      ],
    });
    expect(paths).toContain('items.0.levyAmountA');
  });
  it('keeps UTC timestamps exactly and rejects malformed calendar dates', () => {
    for (const date of [
      '2026-01-01',
      '2026-01-01T08:43:28Z',
      '2026-01-01T08:43:28.121Z',
      '2028-02-29',
    ])
      expect(TransactionDateSchema.safeParse(date).success).toBe(true);
    for (const date of [
      '2026-02-30',
      '2026-01-32',
      '2026-13-01',
      '2026-01-01T25:00:00Z',
      '2026-01-01T12:00:00+01:00',
      '01/01/2026',
    ])
      expect(TransactionDateSchema.safeParse(date).success).toBe(false);
    expect(
      createInvoice({
        invoiceNumber: 'DATE-1',
        transactionDate: '2026-01-01T08:43:28.121Z',
        userName: 'Kofi',
        businessPartnerName: 'Cash',
        businessPartnerTin: 'C0000000000',
        calculationType: 'INCLUSIVE',
        currency: 'USD',
        exchangeRate: 10,
        flag: 'PURCHASE',
        reference: '',
        items: [
          {
            itemCode: 'X',
            description: 'Exempt item',
            quantity: 1,
            unitPrice: parseMoney('100'),
            discountAmount: pesewas(100),
            itemCategory: 'EXM',
          },
        ],
      }).transactionDate,
    ).toBe('2026-01-01T08:43:28.121Z');
  });
  it('handles root schema errors with a $ field path', () => {
    const parsed = z.string().safeParse(null);
    if (parsed.success) throw new Error('Expected schema failure');
    expect(schemaIssues(parsed.error, null)[0]).toMatchObject({
      path: '$',
      expected: 'string',
      received: null,
    });
    expect(validateSchema(z.string(), 'yes')).toEqual({ ok: true, data: 'yes' });
    expect(
      validateSchema(z.object({ nested: z.object({ count: z.number() }) }), { nested: null }).ok,
    ).toBe(false);
  });
});

describe('identity guard', () => {
  it('records first use, ignores harmless whitespace/case and warns without overwriting prior identity', async () => {
    const data = new Map<string, BusinessIdentity>();
    const store = {
      get: (tin: string) => data.get(tin),
      set: (tin: string, identity: BusinessIdentity) => {
        data.set(tin, identity);
      },
    };
    const first = { tin: 'C0000000000', name: 'Accra Books', branch: 'Osu' };
    expect(await guardIdentity(first, store)).toBeUndefined();
    expect(await guardIdentity({ ...first, name: '  ACCRA   books  ' }, store)).toBeUndefined();
    expect(await guardIdentity({ ...first, name: 'Different Company' }, store)).toMatchObject({
      code: 'BUSINESS_NAME_CHANGED',
      previous: first,
    });
    expect(data.get(first.tin)).toBe(first);
  });
  it('supports asynchronous external stores', async () => {
    expect(
      await guardIdentity(
        { tin: 'C0000000000', name: 'Name' },
        { get: async () => undefined, set: async () => undefined },
      ),
    ).toBeUndefined();
  });
});

// Compile-time contract: the builder returns the exact wire type.
const _invoice: Invoice = sampleInvoice();

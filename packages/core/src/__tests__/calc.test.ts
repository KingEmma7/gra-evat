import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  calculateInvoice,
  calculateLine,
  formatMoney,
  GHANA_2026,
  moneyFromWire,
  multiplyMoney,
  parseMoney,
  pesewas,
  sumMoney,
  type CalculatorItem,
  type CalculationType,
  type TaxRules,
} from '../index';

describe('integer money', () => {
  it('parses and formats boundary amounts without floating point operations', () => {
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('001.2')).toBe(120);
    expect(formatMoney(parseMoney('120.01'))).toBe('120.01');
    expect(moneyFromWire(1.25)).toBe(125);
    expect(parseMoney('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(sumMoney([parseMoney('0.01'), parseMoney('1.99')])).toBe(200);
    expect(sumMoney([])).toBe(0);
  });
  it.each(['-1', ' 1', '1 ', '', '.5', '1.001', '1e2', 'NaN', 'Infinity', '90071992547409.92'])(
    'rejects invalid or overflowing decimal %s',
    (value) => {
      expect(() => parseMoney(value)).toThrow(RangeError);
    },
  );
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid pesewas %s',
    (value) => {
      expect(() => pesewas(value)).toThrow(RangeError);
    },
  );
  it('rounds half-pesewa quantity extensions upward', () => {
    expect(multiplyMoney(pesewas(1), '0.5')).toBe(1);
    expect(multiplyMoney(pesewas(1), '0.499999')).toBe(0);
    expect(multiplyMoney(pesewas(3), '0.5')).toBe(2);
  });
  it.each([0, -1, '0', '1e2', '0.0000001', Number.MAX_SAFE_INTEGER + 1, ''])(
    'rejects invalid quantity %s',
    (quantity) => {
      expect(() => multiplyMoney(pesewas(100), quantity)).toThrow(RangeError);
    },
  );
  it('accepts a very large exact quantity then catches monetary overflow', () => {
    expect(multiplyMoney(pesewas(1), Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => multiplyMoney(pesewas(2), Number.MAX_SAFE_INTEGER)).toThrow('safe integer');
  });
});

describe('2026 levy calculator', () => {
  it('matches the Postman 45 × GHS100 example and the official GRA GHS1000 example', () => {
    const line = calculateLine({ unitPrice: parseMoney('100'), quantity: 45 }, 'EXCLUSIVE');
    expect(line).toMatchObject({
      totalAmount: 450000,
      subtotal: 450000,
      nhil: 11250,
      getfund: 11250,
      vat: 67500,
      totalLevy: 22500,
      total: 540000,
    });
    expect(
      calculateLine({ unitPrice: parseMoney('1000'), quantity: 1 }, 'EXCLUSIVE'),
    ).toMatchObject({ nhil: 2500, getfund: 2500, vat: 15000, total: 120000 });
  });
  it('extracts tax from an indivisible inclusive amount and preserves the exact charge', () => {
    const line = calculateLine({ unitPrice: parseMoney('100'), quantity: 1 }, 'INCLUSIVE');
    expect(line).toMatchObject({
      totalAmount: 10000,
      subtotal: 8333,
      nhil: 208,
      getfund: 208,
      vat: 1251,
      total: 10000,
      roundingAdjustment: 1,
    });
  });
  it('rounds an exact half-pesewa levy upward', () => {
    expect(calculateLine({ unitPrice: pesewas(20), quantity: 1 }, 'EXCLUSIVE')).toMatchObject({
      nhil: 1,
      getfund: 1,
      vat: 3,
      total: 25,
    });
  });
  it('discounts the extended line before extracting tax', () => {
    expect(
      calculateLine(
        { unitPrice: parseMoney('120'), quantity: 1, discountAmount: parseMoney('12') },
        'INCLUSIVE',
      ),
    ).toMatchObject({ totalAmount: 12000, discountAmount: 1200, subtotal: 9000, total: 10800 });
    expect(
      calculateLine(
        { unitPrice: parseMoney('100'), quantity: 2, discountAmount: parseMoney('10') },
        'EXCLUSIVE',
      ),
    ).toMatchObject({ subtotal: 19000, total: 22800 });
    expect(() =>
      calculateLine(
        { unitPrice: pesewas(1), quantity: 1, discountAmount: pesewas(2) },
        'EXCLUSIVE',
      ),
    ).toThrow('Discount');
  });
  it('handles EXM and zero money consistently', () => {
    expect(
      calculateLine(
        { unitPrice: parseMoney('100'), quantity: 1, itemCategory: 'EXM' },
        'INCLUSIVE',
      ),
    ).toMatchObject({ subtotal: 10000, nhil: 0, getfund: 0, vat: 0, total: 10000 });
    expect(calculateLine({ unitPrice: pesewas(0), quantity: 1 }, 'EXCLUSIVE').total).toBe(0);
  });
  it('supports 0 through 1000 calculator lines, with per-line rounding', () => {
    expect(calculateInvoice([], 'EXCLUSIVE').total).toBe(0);
    const items = Array.from({ length: 1000 }, () => ({ unitPrice: pesewas(20), quantity: 1 }));
    expect(calculateInvoice(items, 'EXCLUSIVE').total).toBe(25000);
    expect(() =>
      calculateInvoice([...items, { unitPrice: pesewas(20), quantity: 1 }], 'EXCLUSIVE'),
    ).toThrow('1000');
    expect(() =>
      calculateInvoice(
        [
          { unitPrice: pesewas(Number.MAX_SAFE_INTEGER), quantity: 1 },
          { unitPrice: pesewas(1), quantity: 1 },
        ],
        'INCLUSIVE',
      ),
    ).toThrow('safe integer');
  });
  it('validates tax rules, mode and supported categories', () => {
    const item = { unitPrice: pesewas(100), quantity: 1 };
    expect(() => calculateLine(item, 'inclusive' as CalculationType)).toThrow('calculationType');
    expect(() =>
      calculateLine({ ...item, itemCategory: 'CST' } as unknown as CalculatorItem, 'EXCLUSIVE'),
    ).toThrow('Specialized');
    expect(() => calculateLine(item, 'EXCLUSIVE', { ...GHANA_2026, vatBps: -1 })).toThrow(
      'basis points',
    );
    expect(() => calculateLine(item, 'EXCLUSIVE', { ...GHANA_2026, vatBps: 1.5 })).toThrow(
      'basis points',
    );
    expect(() =>
      calculateLine(item, 'EXCLUSIVE', { ...GHANA_2026, method: 'CASCADE' } as unknown as TaxRules),
    ).toThrow('policy');
    expect(
      calculateLine(item, 'EXCLUSIVE', { ...GHANA_2026, vatBps: 0, nhilBps: 0, getfundBps: 0 })
        .total,
    ).toBe(100);
  });
  it('validates calculation policy even when an invoice has no lines', () => {
    expect(() => calculateInvoice([], 'invalid' as CalculationType)).toThrow('calculationType');
    expect(() => calculateInvoice([], 'EXCLUSIVE', { ...GHANA_2026, vatBps: -1 })).toThrow(
      'basis points',
    );
    expect(() =>
      calculateInvoice([], 'EXCLUSIVE', {
        ...GHANA_2026,
        method: 'CASCADE',
      } as unknown as TaxRules),
    ).toThrow('policy');
    expect(calculateInvoice([], 'INCLUSIVE').total).toBe(0);
  });
  it('property: all component totals reconcile and inclusive/exclusive round trips stay within one pesewa', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000000000 }), (amount) => {
        const inclusive = calculateLine({ unitPrice: pesewas(amount), quantity: 1 }, 'INCLUSIVE');
        expect(inclusive.subtotal + inclusive.nhil + inclusive.getfund + inclusive.vat).toBe(
          amount,
        );
        const exclusive = calculateLine(
          { unitPrice: inclusive.subtotal, quantity: 1 },
          'EXCLUSIVE',
        );
        expect(Math.abs(exclusive.total - amount)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 3000, seed: 2026 },
    );
  });
  it('property: invoice totals equal sums for arbitrary prices and quantities', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            price: fc.integer({ min: 0, max: 100000 }),
            quantity: fc.integer({ min: 1, max: 1000 }),
          }),
          { maxLength: 40 },
        ),
        (input) => {
          const totals = calculateInvoice(
            input.map((item) => ({ unitPrice: pesewas(item.price), quantity: item.quantity })),
            'EXCLUSIVE',
          );
          expect(totals.subtotal + totals.totalLevy + totals.vat).toBe(totals.total);
          expect(totals.lines.reduce((sum, line) => sum + line.total, 0)).toBe(totals.total);
        },
      ),
      { numRuns: 500, seed: 1151 },
    );
  });
});

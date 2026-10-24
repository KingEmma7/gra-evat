import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HealthSchema, InvoiceSchema, validateSchema } from '../index';
import { sampleInvoice } from './fixtures';
import diagnostics from './validation-diagnostics.json';

const cases: [string, z.ZodType, unknown][] = [
  ['required', z.string(), undefined],
  ['type', z.string(), null],
  ['enum', z.enum(['GHS', 'USD']), 'ghs'],
  ['enum-type', z.enum(['GHS', 'USD']), 5],
  ['enum-required', z.enum(['GHS', 'USD']), undefined],
  ['literal', z.literal('STANDARD'), 'special'],
  ['unknown', z.object({ name: z.string() }).strict(), { name: 'Ada', extra: 1 }],
  ['short', z.string().min(1), ''],
  ['long', z.string().max(2), 'abc'],
  ['array-short', z.array(z.string()).min(1), []],
  ['array-long', z.array(z.string()).max(2), ['a', 'b', 'c']],
  ['union', z.union([z.number(), z.string()]), null],
  ['regex', z.string().regex(/^\d+$/), 'x'],
  ['negative', z.number().nonnegative(), -1],
  [
    'nested',
    z.object({ lines: z.array(z.object({ code: z.string() })) }),
    { lines: [{ code: null }] },
  ],
  ['custom', z.string().refine(() => false, 'Use the supplied custom message'), 'x'],
];

describe('public validation compatibility', () => {
  // Captured before the dependency migration. These are SDK diagnostics, not Zod internals.
  it.each(cases)('preserves %s diagnostics', (name, schema, input) => {
    const result = validateSchema(schema, input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation failure');
    const expected = diagnostics.find((entry) => entry.name === name);
    expect(expected).toBeDefined();
    expect(JSON.parse(JSON.stringify(result.error.issues))).toEqual(expected?.result);
  });

  it('preserves omitted wire values, exact decimals, strict requests and extensible responses', () => {
    const invoice = sampleInvoice();
    delete invoice.items[0]?.levyAmountC;
    expect(InvoiceSchema.parse(invoice)).toEqual(invoice);
    expect(InvoiceSchema.safeParse({ ...invoice, undocumented: true }).success).toBe(false);
    expect(HealthSchema.parse({ status: 'UP', serverVersion: 'future' })).toEqual({
      status: 'UP',
      serverVersion: 'future',
    });
  });

  it.each([
    [z.string().min(1), [], 'string', 'array'],
    [z.array(z.string()).min(1), '', 'array', 'string'],
  ] as const)(
    'reports only the primary wrong-type failure',
    (schema, input, expected, received) => {
      const result = validateSchema<unknown>(schema, input);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected validation failure');
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]).toMatchObject({
        path: '$',
        expected,
        message: `Expected ${expected}, received ${received}`,
      });
    },
  );

  it('returns a validation error for a bigint literal mismatch', () => {
    const result = validateSchema(z.literal(1n), 2n);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation failure');
    expect(result.error.issues[0]).toMatchObject({
      path: '$',
      expected: '1',
      received: 2n,
      message: 'Invalid literal value, expected \"1\"',
    });
  });

  it('preserves a custom built-in check message', () => {
    const result = validateSchema(z.string().min(5, 'Supply at least five characters'), 'x');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation failure');
    expect(result.error.issues[0]).toMatchObject({
      expected: 'Supply at least five characters',
      message: 'Supply at least five characters',
    });
  });

  it('rejects an oversized constrained collection before visiting its elements', () => {
    let visited = 0;
    const schema = z
      .array(
        z.unknown().superRefine(() => {
          visited += 1;
        }),
      )
      .max(2);
    const result = validateSchema(schema, [1, 2, 3]);
    expect(result.ok).toBe(false);
    expect(visited).toBe(0);
    if (result.ok) throw new Error('Expected collection limit');
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({
      path: '$',
      message: 'Array must contain at most 2 element(s)',
    });
  });
});

import { z } from 'zod';
import { DEFAULT_TIN_PATTERN, GHANA_2026 } from './config';
import {
  calculateInvoice,
  calculateLine,
  formatMoney,
  moneyFromWire,
  multiplyMoney,
  parseMoney,
  pesewas,
  type CalculatorItem,
  type CalculationType,
  type Pesewas,
} from './calc';
import { ValidationError, type Result, type ValidationIssue } from './errors';
import { InvoiceSchema, type Invoice } from './schemas';

function atPath(input: unknown, path: readonly (string | number)[]): unknown {
  let current: unknown = input;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}

/** Convert all schema errors into readable, actionable diagnostics.
 * @example
 * ```ts
 * import { schemaIssues, InvoiceSchema } from '@gra-evat/core';
 * const parsed = InvoiceSchema.safeParse({}); if (!parsed.success) console.log(schemaIssues(parsed.error, {}));
 * ```
 */
export function schemaIssues(error: z.ZodError, input: unknown): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '$',
    expected: 'expected' in issue ? String(issue.expected) : issue.message,
    received: atPath(input, issue.path),
    message: issue.message,
    hint:
      issue.code === 'invalid_enum_value'
        ? `Use exactly one of ${issue.options.join(', ')} (case-sensitive)`
        : issue.code === 'unrecognized_keys'
          ? `Remove undocumented fields: ${issue.keys.join(', ')}`
          : 'Check the documented field format, casing and required value',
  }));
}

/** Validate any exported operation schema and return the SDK result union.
 * @example
 * ```ts
 * import { validateSchema, HealthSchema } from '@gra-evat/core';
 * validateSchema(HealthSchema, { status: 'UP' });
 * ```
 */
export function validateSchema<T>(
  schema: z.ZodType<T>,
  input: unknown,
): Result<T, ValidationError> {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: new ValidationError(schemaIssues(result.error, input)) };
}

export interface ValidationOptions {
  readonly tinPattern?: RegExp;
}

/** Validate an invoice, including tax, money, duplicate code and total reconciliation.
 * @example
 * ```ts
 * import { validateInvoice } from '@gra-evat/core';
 * const result = validateInvoice(JSON.parse('{"flag":"invoice"}')); if (!result.ok) console.log(result.error.issues);
 * ```
 */
export function validateInvoice(
  input: unknown,
  options: ValidationOptions = {},
): Result<Invoice, ValidationError> {
  const shape = validateSchema(InvoiceSchema, input);
  if (!shape.ok) return shape;
  const invoice = shape.data;
  const issues: ValidationIssue[] = [];
  const add = (
    path: string,
    expected: string,
    received: unknown,
    message: string,
    hint: string,
  ): void => {
    issues.push({ path, expected, received, message, hint });
  };
  const pattern = options.tinPattern ?? DEFAULT_TIN_PATTERN;
  // Avoid mutating a supplied global regex's lastIndex.
  if (
    !new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(invoice.businessPartnerTin)
  ) {
    add(
      'businessPartnerTin',
      pattern.source,
      invoice.businessPartnerTin,
      'TIN does not match the configured identity policy',
      'Remove spaces; use a C/P TIN with 10 digits or GHA-123456789-0, or configure tinPattern for a verified alternative',
    );
  }
  if (
    ['REFUND', 'PARTIAL_REFUND', 'PURCHASE_RETURN'].includes(invoice.flag) &&
    !invoice.reference
  ) {
    add(
      'reference',
      'non-empty refund/return identifier',
      invoice.reference,
      'Refunds and returns require a reference',
      'Keep invoiceNumber as the original invoice number and give this refund a unique reference',
    );
  }
  if (invoice.currency === 'GHS' && Number(invoice.exchangeRate) !== 1) {
    add(
      'exchangeRate',
      '1 for GHS',
      invoice.exchangeRate,
      'GHS must use an exchange rate of 1',
      'Set exchangeRate to 1',
    );
  }
  const codes = new Set<string>();
  let gross = 0n;
  let levy = 0n;
  let excise = 0n;
  let discounts = 0n;
  let calculable = true;
  const calculatorItems: CalculatorItem[] = [];
  invoice.items.forEach((item, index) => {
    const path = `items.${index}`;
    if (codes.has(item.itemCode))
      add(
        `${path}.itemCode`,
        'unique code per invoice line',
        item.itemCode,
        'Duplicate item code',
        'Merge quantities into one line or use distinct codes',
      );
    codes.add(item.itemCode);
    try {
      const unitPrice = moneyFromWire(item.unitPrice);
      const extended = multiplyMoney(unitPrice, item.quantity);
      const discount = moneyFromWire(item.discountAmount ?? 0);
      gross += BigInt(extended);
      discounts += BigInt(discount);
      if (discount > extended)
        add(
          `${path}.discountAmount`,
          'at most the extended price',
          item.discountAmount,
          'Discount exceeds this line amount',
          'Reduce the discount',
        );
      for (const key of [
        'levyAmountA',
        'levyAmountB',
        'levyAmountC',
        'levyAmountD',
        'levyAmountE',
      ] as const)
        levy += BigInt(moneyFromWire(item[key] ?? 0));
      excise += BigInt(moneyFromWire(item.exciseAmount ?? 0));
      if (item.itemCategory === '' || item.itemCategory === 'EXM') {
        const calculatorItem = {
          unitPrice,
          quantity: item.quantity,
          discountAmount: discount,
          itemCategory: item.itemCategory,
        };
        calculatorItems.push(calculatorItem);
        if (
          invoice.discountType !== 'SELECTIVE' &&
          invoice.transactionDate.slice(0, 10) >= GHANA_2026.effectiveDate &&
          discount <= extended
        ) {
          const line = calculateLine(calculatorItem, invoice.calculationType);
          for (const [key, expected] of [
            ['levyAmountA', line.nhil],
            ['levyAmountB', line.getfund],
            ['levyAmountD', 0],
            ['levyAmountE', 0],
          ] as const) {
            if (moneyFromWire(item[key]) !== expected)
              add(
                `${path}.${key}`,
                `${expected} pesewas`,
                item[key],
                'Line levy does not match the configured tax rules',
                'Recalculate this line with calculateLine',
              );
          }
        }
      } else calculable = false;
      if (
        invoice.transactionDate.slice(0, 10) >= GHANA_2026.effectiveDate &&
        moneyFromWire(item.levyAmountC ?? 0) !== 0
      ) {
        add(
          `${path}.levyAmountC`,
          '0 for dates from 2026-01-01',
          item.levyAmountC,
          'COVID levy was abolished from 2026',
          'Set levyAmountC to 0 or omit it',
        );
      }
    } catch (error) {
      calculable = false;
      add(
        path,
        'safe integer monetary values',
        item,
        error instanceof Error ? error.message : 'Unsafe monetary value',
        'Use at most two decimal places and keep all computed totals within Number.MAX_SAFE_INTEGER pesewas',
      );
    }
  });
  const compare = (path: string, received: string | number | undefined, expected: bigint): void => {
    try {
      if (BigInt(moneyFromWire(received ?? 0)) !== expected) {
        add(
          path,
          `${expected} pesewas`,
          received,
          'Amount does not reconcile',
          'Recalculate with createInvoice or calculateInvoice',
        );
      }
    } catch (error) {
      add(
        path,
        'safe monetary value',
        received,
        error instanceof Error ? error.message : 'Invalid money',
        'Keep the amount within the safe integer limit in pesewas',
      );
    }
  };
  compare('totalAmount', invoice.totalAmount, gross);
  compare('totalLevy', invoice.totalLevy, levy);
  compare('totalExciseAmount', invoice.totalExciseAmount, excise);
  if (invoice.discountType !== 'SELECTIVE')
    compare('discountAmount', invoice.discountAmount, discounts);
  // ASSUMPTION: Only standard/EXM post-2026 GENERAL invoices have verified formulas; raw specialized, SELECTIVE and historical tax totals are not recomputed.
  if (
    calculable &&
    invoice.discountType !== 'SELECTIVE' &&
    invoice.transactionDate.slice(0, 10) >= GHANA_2026.effectiveDate
  ) {
    try {
      const calculated = calculateInvoice(calculatorItems, invoice.calculationType);
      compare('totalVat', invoice.totalVat, BigInt(calculated.vat));
    } catch (error) {
      add(
        'items',
        'safe computable line values',
        invoice.items,
        error instanceof Error ? error.message : 'Calculation failed',
        'Reduce quantities or monetary amounts',
      );
    }
  }
  return issues.length
    ? { ok: false, error: new ValidationError(issues) }
    : { ok: true, data: invoice };
}

export interface InvoiceBuilderItem extends CalculatorItem {
  readonly itemCode: string;
  readonly description: string;
}
export interface InvoiceBuilderInput {
  readonly invoiceNumber: string;
  readonly transactionDate: string;
  readonly userName: string;
  readonly businessPartnerName: string;
  readonly businessPartnerTin: string;
  readonly currency?: Invoice['currency'];
  readonly exchangeRate?: string | number;
  readonly calculationType: CalculationType;
  readonly items: readonly InvoiceBuilderItem[];
  readonly flag?: Invoice['flag'];
  readonly reference?: string;
}

/** Build a validated standard 2026 invoice from integer monetary input.
 * Only documented wire fields are emitted. Business identity metadata stays local.
 * @example
 * ```ts
 * import { parseMoney, createInvoice } from '@gra-evat/core';
 * createInvoice({invoiceNumber:'INV-1',transactionDate:'2026-01-01',userName:'Kofi',businessPartnerName:'Cash customer',businessPartnerTin:'C0000000000',calculationType:'EXCLUSIVE',items:[{itemCode:'SKU-1',description:'Notebook',quantity:1,unitPrice:parseMoney('100')}]});
 * ```
 */
export function createInvoice(input: InvoiceBuilderInput): Invoice {
  if (input.transactionDate.slice(0, 10) < GHANA_2026.effectiveDate)
    throw new RangeError(
      'The convenience builder supports invoice dates from 2026-01-01; supply a verified historical payload directly',
    );
  const totals = calculateInvoice(input.items, input.calculationType);
  const invoice: Invoice = {
    currency: input.currency ?? 'GHS',
    exchangeRate: input.exchangeRate ?? '1.0',
    invoiceNumber: input.invoiceNumber,
    totalLevy: formatMoney(totals.totalLevy),
    userName: input.userName,
    flag: input.flag ?? 'INVOICE',
    calculationType: input.calculationType,
    totalVat: formatMoney(totals.vat),
    transactionDate: input.transactionDate,
    totalAmount: formatMoney(totals.totalAmount),
    totalExciseAmount: '0.00',
    businessPartnerName: input.businessPartnerName,
    businessPartnerTin: input.businessPartnerTin,
    saleType: 'NORMAL',
    discountType: 'GENERAL',
    taxType: 'STANDARD',
    discountAmount: formatMoney(totals.discountAmount),
    reference: input.reference ?? '',
    groupReferenceId: '',
    purchaseOrderReference: '',
    items: input.items.map((item, index) => {
      const line = totals.lines[index];
      if (line === undefined) throw new RangeError('Missing line totals');
      return {
        itemCode: item.itemCode,
        itemCategory: item.itemCategory ?? '',
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: formatMoney(item.unitPrice),
        levyAmountA: formatMoney(line.nhil),
        levyAmountB: formatMoney(line.getfund),
        levyAmountC: '0.00',
        levyAmountD: '0.00',
        levyAmountE: '0.00',
        discountAmount: formatMoney(line.discountAmount),
        exciseAmount: '0.00',
        expireDate: '',
        batchCode: '',
      };
    }),
  };
  const result = validateInvoice(invoice);
  if (!result.ok) throw result.error;
  return result.data;
}

/** Local-only merchant metadata. This is never inserted into a GRA payload. */
export interface BusinessIdentity {
  readonly tin: string;
  readonly name: string;
  readonly branch?: string;
}
/** Optional customer metadata. GRA still requires explicit partner fields on invoices. */
export interface Customer {
  readonly tin?: string;
  readonly name?: string;
  readonly phone?: string;
}
export interface IdentityStore {
  get(tin: string): BusinessIdentity | undefined | Promise<BusinessIdentity | undefined>;
  set(tin: string, identity: BusinessIdentity): void | Promise<void>;
}
export interface IdentityWarning {
  readonly code: 'BUSINESS_NAME_CHANGED';
  readonly previous: BusinessIdentity;
  readonly submitted: BusinessIdentity;
}

/** Warn when a previously recorded TIN is submitted with a different name.
 * @example
 * ```ts
 * import { guardIdentity } from '@gra-evat/core';
 * await guardIdentity({tin:'C0000000000',name:'Accra Books'}, {get:()=>undefined,set:()=>{}});
 * ```
 */
export async function guardIdentity(
  identity: BusinessIdentity,
  store: IdentityStore,
): Promise<IdentityWarning | undefined> {
  const previous = await store.get(identity.tin);
  const normalized = (name: string): string =>
    name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GH');
  if (previous && normalized(previous.name) !== normalized(identity.name))
    return { code: 'BUSINESS_NAME_CHANGED', previous, submitted: identity };
  if (!previous) await store.set(identity.tin, identity);
  return undefined;
}

/** Sum exact monetary fields for a custom boundary adapter.
 * @example
 * ```ts
 * import { parseMoney, sumMoney } from '@gra-evat/core';
 * sumMoney([parseMoney('1.00'), parseMoney('2.00')]); // 300
 * ```
 */
export function sumMoney(values: readonly Pesewas[]): Pesewas {
  const total = values.reduce((sum, value) => sum + BigInt(pesewas(value)), 0n);
  return parseMoney(`${total / 100n}.${String(total % 100n).padStart(2, '0')}`);
}

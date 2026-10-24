import { GHANA_2026, LIMITS, type TaxRules } from './config';

declare const pesewasBrand: unique symbol;
/** Safe integer minor units. One Ghana cedi is 100 pesewas. */
export type Pesewas = number & { readonly [pesewasBrand]: 'Pesewas' };
export type CalculationType = 'INCLUSIVE' | 'EXCLUSIVE';
export interface CalculatorItem {
  readonly unitPrice: Pesewas;
  readonly quantity: string | number;
  readonly discountAmount?: Pesewas;
  readonly itemCategory?: '' | 'EXM';
}
export interface LineTotals {
  readonly totalAmount: Pesewas;
  readonly subtotal: Pesewas;
  readonly nhil: Pesewas;
  readonly getfund: Pesewas;
  readonly vat: Pesewas;
  readonly totalLevy: Pesewas;
  readonly total: Pesewas;
  readonly discountAmount: Pesewas;
  readonly roundingAdjustment: Pesewas;
}
export interface InvoiceTotals extends LineTotals {
  readonly lines: readonly LineTotals[];
}

/** Brand an integer amount, rejecting unsafe or negative money.
 * @example
 * ```ts
 * import { pesewas } from '@gra-evat/core';
 * const amount = pesewas(1250); // GHS 12.50
 * ```
 */
export function pesewas(value: number): Pesewas {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('Money must be a non-negative safe integer in pesewas');
  return value as Pesewas;
}

function checked(value: bigint): Pesewas {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Money exceeds the safe integer limit');
  return Number(value) as Pesewas;
}

/** Parse a decimal monetary value without binary floating point arithmetic.
 * @example
 * ```ts
 * import { pesewas, parseMoney } from '@gra-evat/core';
 * const price = parseMoney('100.25'); // 10025 pesewas
 * ```
 */
export function parseMoney(value: string): Pesewas {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new RangeError('Money must be a non-negative decimal with at most 2 decimal places');
  const [whole = '0', fraction = ''] = value.split('.');
  return checked(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
}

/** Format minor units as the exact decimal value used at the JSON boundary.
 * @example
 * ```ts
 * import { pesewas, formatMoney } from '@gra-evat/core';
 * formatMoney(pesewas(1234)); // '12.34'
 * ```
 */
export function formatMoney(value: Pesewas): string {
  const integer = BigInt(pesewas(value));
  return `${integer / 100n}.${String(integer % 100n).padStart(2, '0')}`;
}

/** Convert a documented JSON number or string to minor units.
 * @example
 * ```ts
 * import { pesewas, moneyFromWire } from '@gra-evat/core';
 * moneyFromWire('12.50'); // 1250 pesewas
 * ```
 */
export function moneyFromWire(value: string | number): Pesewas {
  return parseMoney(String(value));
}

function ratio(value: string | number): readonly [bigint, bigint] {
  const text = String(value);
  const expression = new RegExp(`^\\d+(?:\\.\\d{1,${LIMITS.quantityDecimals}})?$`);
  if (!expression.test(text))
    throw new RangeError(
      `Quantity must be a positive decimal with at most ${LIMITS.quantityDecimals} decimal places`,
    );
  const [whole = '0', fraction = ''] = text.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || '0');
  if (numerator === 0n || numerator > BigInt(Number.MAX_SAFE_INTEGER) * denominator)
    throw new RangeError('Quantity must be positive and at most Number.MAX_SAFE_INTEGER');
  return [numerator, denominator];
}

function round(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Multiply quantity and price exactly, rounding once to the nearest pesewa.
 * @example
 * ```ts
 * import { pesewas, multiplyMoney } from '@gra-evat/core';
 * multiplyMoney(pesewas(1), '0.5'); // 1 pesewa, half up
 * ```
 */
export function multiplyMoney(unitPrice: Pesewas, quantity: string | number): Pesewas {
  const [numerator, denominator] = ratio(quantity);
  return checked(round(BigInt(pesewas(unitPrice)) * numerator, denominator));
}

function assertRules(rules: TaxRules): void {
  if (rules.method !== 'SAME_BASE' || rules.rounding !== 'HALF_UP_PER_LINE')
    throw new RangeError('Unsupported tax computation policy');
  for (const value of [rules.vatBps, rules.nhilBps, rules.getfundBps]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 10000)
      throw new RangeError('Tax rates must be integer basis points between 0 and 10000');
  }
}

/** Calculate one standard or EXM line using exact integer arithmetic.
 * GENERAL discounts reduce the line before tax. Specialized categories require raw payloads.
 * @example
 * ```ts
 * import { parseMoney, calculateLine } from '@gra-evat/core';
 * calculateLine({ unitPrice: parseMoney('100'), quantity: 1 }, 'EXCLUSIVE').total; // 12000
 * ```
 */
export function calculateLine(
  item: CalculatorItem,
  calculationType: CalculationType,
  rules: TaxRules = GHANA_2026,
): LineTotals {
  assertRules(rules);
  if (calculationType !== 'EXCLUSIVE' && calculationType !== 'INCLUSIVE')
    throw new RangeError('calculationType must be INCLUSIVE or EXCLUSIVE');
  if (item.itemCategory !== undefined && item.itemCategory !== '' && item.itemCategory !== 'EXM')
    throw new RangeError('Specialized categories are not supported by the convenience calculator');
  const amount = multiplyMoney(item.unitPrice, item.quantity);
  const discount = pesewas(item.discountAmount ?? 0);
  if (discount > amount) throw new RangeError('Discount cannot exceed the extended line price');
  // ASSUMPTION: GENERAL's ambiguous "tax exempt" discount wording means deduct the line discount before computing tax.
  const net = BigInt(amount) - BigInt(discount);
  const exempt = item.itemCategory === 'EXM';
  const bps = 10000n;
  const combinedRate = BigInt(rules.vatBps + rules.nhilBps + rules.getfundBps);
  const subtotal =
    exempt || calculationType === 'EXCLUSIVE' ? net : round(net * bps, bps + combinedRate);
  const nhil = exempt ? 0n : round(subtotal * BigInt(rules.nhilBps), bps);
  const getfund = exempt ? 0n : round(subtotal * BigInt(rules.getfundBps), bps);
  const computedVat = exempt ? 0n : round(subtotal * BigInt(rules.vatBps), bps);
  // ASSUMPTION: Allocate an inclusive rounding residual to VAT so the charged amount reconciles exactly.
  const vat =
    calculationType === 'INCLUSIVE' && !exempt ? net - subtotal - nhil - getfund : computedVat;
  // At very small inclusive values the independent levy rounding can exceed the available tax.
  if (vat < 0n) throw new RangeError('Tax policy produces a negative inclusive VAT amount');
  const adjustment = vat - computedVat;
  return {
    totalAmount: amount,
    subtotal: checked(subtotal),
    nhil: checked(nhil),
    getfund: checked(getfund),
    vat: checked(vat),
    totalLevy: checked(nhil + getfund),
    total: checked(subtotal + nhil + getfund + vat),
    discountAmount: discount,
    roundingAdjustment: Number(adjustment) as Pesewas,
  };
}

/** Sum line results, preserving per-line rounding and rejecting overflow.
 * @example
 * ```ts
 * import { parseMoney, calculateInvoice } from '@gra-evat/core';
 * calculateInvoice([{unitPrice: parseMoney('100'), quantity: 1}], 'INCLUSIVE').total; // 10000
 * ```
 */
export function calculateInvoice(
  items: readonly CalculatorItem[],
  calculationType: CalculationType,
  rules: TaxRules = GHANA_2026,
): InvoiceTotals {
  assertRules(rules);
  if (calculationType !== 'EXCLUSIVE' && calculationType !== 'INCLUSIVE')
    throw new RangeError('calculationType must be INCLUSIVE or EXCLUSIVE');
  if (items.length > LIMITS.maxItems)
    throw new RangeError(`At most ${LIMITS.maxItems} lines are supported`);
  const lines = items.map((item) => calculateLine(item, calculationType, rules));
  const sum = (key: keyof LineTotals): Pesewas =>
    checked(lines.reduce((total, line) => total + BigInt(line[key]), 0n));
  return {
    lines,
    totalAmount: sum('totalAmount'),
    subtotal: sum('subtotal'),
    nhil: sum('nhil'),
    getfund: sum('getfund'),
    vat: sum('vat'),
    totalLevy: sum('totalLevy'),
    total: sum('total'),
    discountAmount: sum('discountAmount'),
    roundingAdjustment: Number(
      lines.reduce((total, line) => total + BigInt(line.roundingAdjustment), 0n),
    ) as Pesewas,
  };
}

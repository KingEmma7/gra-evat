import { moneyFromWire, type GraResponse, type Invoice } from '@gra-evat/core';

type Fraction = { numerator: bigint; denominator: bigint };

function fraction(value: number | string): Fraction {
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) throw new MockStoreError('Invalid_quantity');
  const digits = match[2] ?? '';
  const exponent = Number(match[3] ?? 0) - digits.length;
  return exponent >= 0
    ? { numerator: BigInt(`${match[1]}${digits}`) * 10n ** BigInt(exponent), denominator: 1n }
    : { numerator: BigInt(`${match[1]}${digits}`), denominator: 10n ** BigInt(-exponent) };
}

function add(left: Fraction, right: Fraction): Fraction {
  const numerator = left.numerator * right.denominator + right.numerator * left.denominator;
  const denominator = left.denominator * right.denominator;
  let first = numerator;
  let second = denominator;
  while (second !== 0n) [first, second] = [second, first % second];
  return { numerator: numerator / first, denominator: denominator / first };
}

function compare(left: Fraction, right: Fraction): number {
  const result = left.numerator * right.denominator - right.numerator * left.denominator;
  return result < 0n ? -1 : result > 0n ? 1 : 0;
}

function equalDecimal(left: number | string, right: number | string): boolean {
  return compare(fraction(left), fraction(right)) === 0;
}

const moneyFields = [
  'totalAmount',
  'discountAmount',
  'totalLevy',
  'totalVat',
  'totalExciseAmount',
] as const;
type MoneyField = (typeof moneyFields)[number];

function amount(payload: Invoice, field: MoneyField): bigint {
  return BigInt(moneyFromWire(payload[field] ?? 0));
}

function payable(payload: Invoice): bigint {
  // ASSUMPTION: mock refund credit is gross minus discount, plus VAT/levies/excise for EXCLUSIVE prices; vouchers are tender, not a tax discount.
  const net = amount(payload, 'totalAmount') - amount(payload, 'discountAmount');
  return payload.calculationType === 'INCLUSIVE'
    ? net
    : net +
        amount(payload, 'totalLevy') +
        amount(payload, 'totalVat') +
        amount(payload, 'totalExciseAmount');
}

interface Sale {
  payload: Invoice;
  response: GraResponse;
  closed: boolean;
}

interface Reversal {
  payload: Invoice;
  response: GraResponse;
  cancelled: boolean;
}

/** A mock business rule failure. Its message matches the documented error string style. */
export class MockStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MockStoreError';
  }
}

/**
 * Isolated, in-memory transactions for one mock taxpayer. No persistence is implied.
 * @example
 * const store = new MockStore();
 * console.log(store.size); // 0
 */
export class MockStore {
  private readonly sales = new Map<string, Sale>();
  private readonly reversals = new Map<string, Reversal>();
  private readonly auxiliaryIds = new Set<string>();

  get size(): number {
    return this.sales.size;
  }

  /** Register an invoice or purchase after validation. */
  create(payload: Invoice, response: GraResponse): void {
    if (this.sales.has(payload.invoiceNumber)) {
      throw new MockStoreError(`Invoice_${payload.invoiceNumber}_already_signed`);
    }
    this.sales.set(payload.invoiceNumber, { payload, response, closed: false });
  }

  /**
   * Reverse quantities against a prior sale or purchase.
   * @example
   * // Called by the mock route after validateInvoice succeeds.
   * store.reverse(refund, signedRefund);
   */
  reverse(payload: Invoice, response: GraResponse): void {
    const original = this.sales.get(payload.invoiceNumber);
    if (!original) throw new MockStoreError('Original_invoice_not_found');
    if (original.closed) throw new MockStoreError('Original_invoice_already_cancelled');
    const isPurchase = original.payload.flag === 'PURCHASE';
    if (isPurchase !== (payload.flag === 'PURCHASE_RETURN')) {
      throw new MockStoreError('Refund_transaction_type_must_match_original');
    }
    // ASSUMPTION: v8.2's refund examples are inconsistent; invoiceNumber locates the original and reference identifies this refund.
    if (!payload.reference) throw new MockStoreError('Refund_reference_required');
    if (this.reversals.has(payload.reference))
      throw new MockStoreError('Refund_reference_already_used');
    if (
      payload.currency !== original.payload.currency ||
      payload.calculationType !== original.payload.calculationType ||
      payload.saleType !== original.payload.saleType ||
      payload.discountType !== original.payload.discountType ||
      !equalDecimal(payload.exchangeRate, original.payload.exchangeRate) ||
      payload.businessPartnerTin !== original.payload.businessPartnerTin
    ) {
      throw new MockStoreError('Refund_pricing_and_customer_must_match_original');
    }
    const prior = [...this.reversals.values()].filter(
      (entry) => entry.payload.invoiceNumber === payload.invoiceNumber && !entry.cancelled,
    );
    const requested = new Map(payload.items.map((item) => [item.itemCode, item]));
    for (const item of payload.items) {
      const sold = original.payload.items.find((line) => line.itemCode === item.itemCode);
      if (!sold) throw new MockStoreError(`Refund_item_${item.itemCode}_not_sold`);
      if (
        !equalDecimal(item.unitPrice, sold.unitPrice) ||
        item.itemCategory !== sold.itemCategory ||
        item.description !== sold.description
      ) {
        throw new MockStoreError(`Refund_item_${item.itemCode}_must_match_original`);
      }
      // ASSUMPTION: line discounts on partial refunds are apportioned by quantity, rounded half up to pesewas.
      const refundDiscount = fraction(item.discountAmount ?? 0);
      const originalDiscount = fraction(sold.discountAmount ?? 0);
      const units = fraction(item.quantity);
      const originalUnits = fraction(sold.quantity);
      const discountNumerator =
        originalDiscount.numerator * units.numerator * originalUnits.denominator * 100n;
      const discountDenominator =
        originalDiscount.denominator * units.denominator * originalUnits.numerator;
      const expectedMinor =
        (discountNumerator * 2n + discountDenominator) / (discountDenominator * 2n);
      if (compare(refundDiscount, { numerator: expectedMinor, denominator: 100n }) !== 0) {
        throw new MockStoreError(`Refund_discount_${item.itemCode}_must_match_original`);
      }
      const refunded = prior.reduce(
        (total, entry) => {
          const previous = entry.payload.items.find((line) => line.itemCode === item.itemCode);
          return previous ? add(total, fraction(previous.quantity)) : total;
        },
        { numerator: 0n, denominator: 1n },
      );
      if (compare(add(refunded, fraction(item.quantity)), fraction(sold.quantity)) > 0) {
        throw new MockStoreError(`Refund_quantity_${item.itemCode}_exceeds_original`);
      }
    }
    // ASSUMPTION: reject cumulative credit/tax/discount rounding beyond the original; callers cancel and consolidate refunds instead of inventing adjustment fields.
    const cumulativePayable = prior.reduce(
      (sum, entry) => sum + payable(entry.payload),
      payable(payload),
    );
    if (payable(payload) < 0n || cumulativePayable > payable(original.payload)) {
      throw new MockStoreError('Refund_payable_exceeds_original_after_rounding');
    }
    const cumulative = new Map(
      moneyFields.map((field) => [
        field,
        prior.reduce((sum, entry) => sum + amount(entry.payload, field), amount(payload, field)),
      ]),
    );
    for (const field of moneyFields) {
      const total = cumulative.get(field);
      if (total !== undefined && total > amount(original.payload, field)) {
        throw new MockStoreError(`Refund_${field}_exceeds_original_after_rounding`);
      }
    }
    const fullyReversed = original.payload.items.every((sold) => {
      const item = requested.get(sold.itemCode);
      const refunded = prior.reduce(
        (total, entry) => {
          const previous = entry.payload.items.find((line) => line.itemCode === sold.itemCode);
          return previous ? add(total, fraction(previous.quantity)) : total;
        },
        { numerator: 0n, denominator: 1n },
      );
      const total = add(
        refunded,
        item ? fraction(item.quantity) : { numerator: 0n, denominator: 1n },
      );
      return compare(total, fraction(sold.quantity)) === 0;
    });
    if (
      fullyReversed &&
      (cumulativePayable !== payable(original.payload) ||
        moneyFields.some((field) => cumulative.get(field) !== amount(original.payload, field)))
    ) {
      throw new MockStoreError(
        'Refund_rounding_requires_cancelling_and_consolidating_prior_refunds',
      );
    }
    // ASSUMPTION: full refunds and purchase returns reverse every remaining unit, then close the transaction.
    if (payload.flag === 'REFUND' || payload.flag === 'PURCHASE_RETURN') {
      if (!fullyReversed) {
        throw new MockStoreError('Full_refund_must_reverse_all_remaining_items');
      }
      original.closed = true;
    }
    this.reversals.set(payload.reference, { payload, response, cancelled: false });
  }

  /** Restore the quantities reversed by one prior refund. */
  cancel(
    invoiceNumber: string,
    reference: string,
    purchase: boolean,
    amount: number | string,
  ): void {
    const entry = this.reversals.get(reference);
    if (!entry || entry.payload.invoiceNumber !== invoiceNumber)
      throw new MockStoreError('Refund_not_found');
    if (entry.cancelled) throw new MockStoreError('Refund_already_cancelled');
    if ((entry.payload.flag === 'PURCHASE_RETURN') !== purchase)
      throw new MockStoreError('Cancellation_type_mismatch');
    if (!equalDecimal(amount, entry.payload.totalAmount))
      throw new MockStoreError('Cancellation_amount_must_match_refund');
    entry.cancelled = true;
    const original = this.sales.get(invoiceNumber);
    if (original) original.closed = false;
  }

  /** Retrieve a signed receipt with the documented callback identifiers. */
  callback(invoiceNumber: string, flag: string, reference?: string): GraResponse {
    if (flag === 'INVOICE' || flag === 'PURCHASE') {
      const sale = this.sales.get(invoiceNumber);
      if (!sale || sale.payload.flag !== flag) throw new MockStoreError('Invoice_not_found');
      return sale.response;
    }
    const refund = reference ? this.reversals.get(reference) : undefined;
    if (!refund || refund.payload.invoiceNumber !== invoiceNumber)
      throw new MockStoreError('Refund_not_found');
    if (
      refund.payload.flag !== flag &&
      !(flag === 'REFUND' && refund.payload.flag === 'PARTIAL_REFUND')
    ) {
      throw new MockStoreError('Refund_transaction_type_mismatch');
    }
    return refund.response;
  }

  /** Check that an auxiliary operation refers to a stored transaction. */
  requireInvoice(invoiceNumber: string): void {
    if (!this.sales.has(invoiceNumber)) throw new MockStoreError('Original_invoice_not_found');
  }

  /** Reject duplicate note/group references. */
  reserve(identifier: string): void {
    if (this.auxiliaryIds.has(identifier)) throw new MockStoreError('Reference_already_used');
    this.auxiliaryIds.add(identifier);
  }
}

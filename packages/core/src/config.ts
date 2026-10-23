/** Tax policy version. Values are basis points on the same taxable base. */
export interface TaxRules {
  readonly id: string;
  readonly effectiveDate: string;
  readonly method: 'SAME_BASE';
  readonly rounding: 'HALF_UP_PER_LINE';
  readonly vatBps: number;
  readonly nhilBps: number;
  readonly getfundBps: number;
}

/** GRA VAT Act 1151 policy effective 1 January 2026. */
export const GHANA_2026: TaxRules = Object.freeze({
  id: 'GH-2026-01-01',
  effectiveDate: '2026-01-01',
  method: 'SAME_BASE',
  // ASSUMPTION: GRA sources do not prescribe half-pesewa rounding or its scope.
  rounding: 'HALF_UP_PER_LINE',
  vatBps: 1500,
  nhilBps: 250,
  getfundBps: 250,
});

/** Wire paths from Postman v8.2; retain the documented statement typo. */
export const ENDPOINTS = Object.freeze({
  invoice: 'invoice',
  cancellation: 'cancellation',
  note: 'note',
  statementOfAccount: 'statment_of_account',
  health: 'health',
  inventory: 'inventory',
  callback: 'invoice/callback',
  tin: 'identification/tin',
  nationalId: 'identification/nationalId',
});

// ASSUMPTION: v8.2 specifies no maximum line count or quantity precision; these are local SDK safety limits.
/** Local safety limits, independent of GRA's undocumented maximum payload size. */
export const LIMITS = Object.freeze({ maxItems: 1000, quantityDecimals: 6 });

// ASSUMPTION: v8.2 gives conflicting example lengths and no normative TIN regex.
/** Local default identity policy; pass tinPattern to validation to override it. */
export const DEFAULT_TIN_PATTERN = /^(?:[CP]\d{10}|GHA-\d{9}-\d)$/;

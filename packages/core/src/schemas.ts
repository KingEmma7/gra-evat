import { z } from 'zod';
import { LIMITS } from './config';

const text = (maximum: number) => z.string().min(1).max(maximum);
const optionalText = (maximum: number) => z.string().max(maximum).optional();
const decimal = z.union([
  z.number().finite().nonnegative(),
  z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .refine((value) => Number.isFinite(Number(value)), 'Use a finite numeric value'),
]);
const money = decimal.refine(
  (value) => /^\d+(?:\.\d{1,2})?$/.test(String(value)),
  'Use a non-negative amount with at most 2 decimal places',
);
const quantity = decimal.refine(
  (value) =>
    /^\d+(?:\.\d{1,6})?$/.test(String(value)) &&
    Number(value) > 0 &&
    Number(value) <= Number.MAX_SAFE_INTEGER,
  'Quantity must be positive, safe, and have at most 6 decimal places',
);

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z)?$/.test(value)) return false;
  const stamp = Date.parse(value);
  return (
    Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value.slice(0, 10)
  );
}

/** Exact Postman date-only or UTC ISO timestamp, preserved without conversion. */
export const TransactionDateSchema = z
  .string()
  .refine(isDate, 'Use a valid YYYY-MM-DD date or UTC ISO timestamp ending in Z');
/** Currencies listed explicitly in the v8.2 tag table. */
export const CurrencySchema = z.enum(['GHS', 'USD', 'EUR', 'GBP']);
export const CalculationTypeSchema = z.enum(['INCLUSIVE', 'EXCLUSIVE']);
export const InvoiceFlagSchema = z.enum([
  'INVOICE',
  'PURCHASE',
  'REFUND',
  'PARTIAL_REFUND',
  'PURCHASE_RETURN',
]);
export const ItemCategorySchema = z.enum(['', 'CST', 'TRSM', 'EXM', 'RNT', 'EXC_PLASTIC']);

/** JSON line fields from the tag table and request examples. */
export const LineItemSchema = z
  .object({
    itemCode: text(50),
    itemCategory: ItemCategorySchema,
    description: text(100),
    quantity,
    unitPrice: money,
    levyAmountA: money,
    levyAmountB: money,
    // ASSUMPTION: The tag table requires C, but 2026 examples omit it; absent means zero.
    levyAmountC: money.optional(),
    levyAmountD: money,
    levyAmountE: money,
    expireDate: z.union([z.literal(''), TransactionDateSchema]).optional(),
    discountAmount: money.optional(),
    exciseAmount: money.optional(),
    batchCode: optionalText(100),
  })
  .strict();

/** Exact invoice/purchase/refund JSON payload shared by /invoice. */
export const InvoiceSchema = z
  .object({
    currency: CurrencySchema,
    exchangeRate: decimal.refine((value) => Number(value) > 0, 'Exchange rate must be positive'),
    invoiceNumber: text(100),
    totalLevy: money,
    userName: text(100),
    flag: InvoiceFlagSchema,
    calculationType: CalculationTypeSchema,
    totalVat: money,
    transactionDate: TransactionDateSchema,
    totalAmount: money,
    totalExciseAmount: money.optional(),
    voucherAmount: money.optional(),
    businessPartnerName: text(100),
    businessPartnerTin: text(15),
    saleType: z.enum(['NORMAL', 'EXPORT']),
    discountType: z.enum(['GENERAL', 'SELECTIVE']).optional(),
    discountAmount: money.optional(),
    // ASSUMPTION: STANDARD is the only observed taxType; other values need source evidence.
    taxType: z.literal('STANDARD').optional(),
    reference: optionalText(50),
    groupReferenceId: optionalText(50),
    // ASSUMPTION: purchaseOrderReference occurs in requests without a length rule; 100 is a local SDK bound.
    purchaseOrderReference: optionalText(100),
    items: z.array(LineItemSchema).min(1).max(LIMITS.maxItems),
  })
  .strict();

/** Cancellation flags follow actual requests, including their single-L spelling. */
export const CancellationSchema = z
  .object({
    invoiceNumber: text(100),
    reference: text(50),
    userName: text(100),
    flag: z.enum(['REFUND_CANCELATION', 'PURCHASE_RETURN_CANCELATION']),
    transactionDate: TransactionDateSchema,
    totalAmount: money,
  })
  .strict();

// ASSUMPTION: note/account/inventory field lengths are local safeguards inferred from equivalent invoice fields.
/** The collection supplies a CREDIT_NOTE request; it does not define a DEBIT_NOTE enum. */
export const NoteSchema = z
  .object({
    noteNumber: text(100),
    currency: CurrencySchema,
    exchangeRate: decimal,
    noteAmount: money,
    calculationType: CalculationTypeSchema,
    businessPartnerName: text(100),
    businessPartnerTin: text(15),
    userName: text(100),
    flag: z.literal('CREDIT_NOTE'),
    groupReferenceId: z.string().max(50),
    transactionDate: TransactionDateSchema,
    remarks: z.string(),
    noteLineFlag: z.literal('INVOICE'),
    noteLines: z
      .array(
        z
          .object({
            invoiceNumber: text(100),
            invoiceDate: TransactionDateSchema,
            invoiceAmount: money,
          })
          .strict(),
      )
      .min(1)
      .max(LIMITS.maxItems),
  })
  .strict();

/** Statement figures retain the arbitrary decimal precision shown in the collection. */
export const StatementOfAccountSchema = z
  .object({
    currency: CurrencySchema,
    exchangeRate: decimal,
    totalVat: decimal,
    totalAmount: decimal,
    totalLevies: decimal,
    userName: text(100),
    businessPartnerName: text(100),
    businessPartnerTin: text(15),
    groupReferenceId: text(50),
    transactionDate: TransactionDateSchema,
    calculationType: CalculationTypeSchema,
    groupInvoiceLines: z
      .array(
        z
          .object({
            currency: CurrencySchema,
            exchangeRate: decimal,
            calculationType: CalculationTypeSchema,
            invoiceNumber: text(100),
            reference: optionalText(50),
            flag: InvoiceFlagSchema,
            invoiceVat: decimal,
            invoiceAmount: decimal,
            invoiceLevies: decimal,
            transactionDate: TransactionDateSchema,
          })
          .strict(),
      )
      .min(1)
      .max(LIMITS.maxItems),
  })
  .strict();

export const InventorySchema = z
  .object({
    inventoryDate: TransactionDateSchema,
    inventories: z
      .array(
        z
          .object({
            code: text(50),
            description: text(100),
            quantity,
            batchCode: z.string().max(100),
            unitPrice: money,
            expiryDate: TransactionDateSchema,
          })
          .strict(),
      )
      .min(1)
      .max(LIMITS.maxItems),
  })
  .strict();

export const CallbackSchema = z
  .object({ reference: z.string().max(50), invoiceNumber: text(100), flag: InvoiceFlagSchema })
  .strict();

/** JSON success envelope, retaining ysdcmrctim exactly as in response examples. */
export const GraResponseSchema = z
  .object({
    response: z
      .object({
        distributor_tin: z.string(),
        message: z
          .object({
            num: z.string(),
            ysdcid: z.string(),
            ysdcrecnum: z.string(),
            ysdcintdata: z.string(),
            ysdcregsig: z.string(),
            ysdcmrc: z.string(),
            ysdcmrctim: z.string(),
            ysdctime: z.string(),
            flag: z.string(),
            ysdcitems: z.string(),
          })
          .passthrough(),
        qr_code: z.string(),
        status: z.literal('SUCCESS'),
      })
      .passthrough(),
  })
  .passthrough();
export const HealthSchema = z.object({ status: z.literal('UP') }).passthrough();
export const InventoryResponseSchema = z.object({ status: z.literal('SUCCESS') }).passthrough();
export const IdentificationSchema = z
  .object({
    status: z.literal('SUCCESS'),
    data: z
      .object({
        tin: z.string(),
        type: z.string(),
        name: z.string(),
        sector: z.string(),
        address: z.string(),
      })
      .passthrough(),
  })
  .passthrough();
export const GraErrorResponseSchema = z
  .object({ timestamp: z.string(), status: z.number(), error: z.string() })
  .passthrough();

// ASSUMPTION: cancellation/note/statement have no response examples; this is a MOCK-ONLY response.
export const AssumedAcknowledgementSchema = z.object({ status: z.literal('SUCCESS') });

export type LineItem = z.infer<typeof LineItemSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type Refund = Invoice & { flag: 'REFUND' };
export type PartialRefund = Invoice & { flag: 'PARTIAL_REFUND' };
export type Purchase = Invoice & { flag: 'PURCHASE' };
export type Cancellation = z.infer<typeof CancellationSchema>;
export type RefundCancellation = Cancellation & { flag: 'REFUND_CANCELATION' };
export type Note = z.infer<typeof NoteSchema>;
export type StatementOfAccount = z.infer<typeof StatementOfAccountSchema>;
export type Inventory = z.infer<typeof InventorySchema>;
export type Callback = z.infer<typeof CallbackSchema>;
export type GraResponse = z.infer<typeof GraResponseSchema>;
export type Health = z.infer<typeof HealthSchema>;
export type Identification = z.infer<typeof IdentificationSchema>;
export type AssumedAcknowledgement = z.infer<typeof AssumedAcknowledgementSchema>;

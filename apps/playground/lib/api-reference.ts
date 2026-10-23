import type {
  Cancellation,
  GraResponse,
  Inventory,
  Invoice,
  Note,
  StatementOfAccount,
} from '@gra-evat/core';

/** Request keys and response shapes follow the public Postman v8.2 collection. */
export interface EndpointReference {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly request: string;
  readonly requestLabel: string;
  readonly response: string;
  readonly responseLabel: string;
  readonly responseNote: string;
}

const prefix = '/vsdc/api/v1/taxpayer/C0000000000-001';
const date = '2026-01-01';
const stamp = '2026/01/01 12:00:00';
const unknownResponseNote =
  'Postman v8.2 supplies no GRA response example for this operation. The SDK preserves unknown JSON. This acknowledgement is specific to the local mock.';
const mockResponseNote =
  'The response follows the documented shape with synthetic mock values. Its signatures and verification URL are fake.';

// Exact documented keys. Synthetic identifiers and 2026 amounts make the examples usable together.
const invoice = {
  currency: 'GHS',
  exchangeRate: '1.0',
  invoiceNumber: 'INV-2026-001',
  totalLevy: 225,
  userName: 'Kofi Ghana',
  flag: 'INVOICE',
  calculationType: 'EXCLUSIVE',
  totalVat: 675,
  transactionDate: date,
  totalAmount: 4500,
  totalExciseAmount: 0,
  businessPartnerName: 'Cash customer',
  businessPartnerTin: 'C0000000000',
  saleType: 'NORMAL',
  discountType: 'GENERAL',
  taxType: 'STANDARD',
  discountAmount: 0,
  reference: '',
  groupReferenceId: '',
  purchaseOrderReference: '',
  items: [
    {
      itemCode: 'ABT301',
      itemCategory: '',
      expireDate: '',
      description: 'Abrokyire Ntomah',
      quantity: '45',
      levyAmountA: 112.5,
      levyAmountB: 112.5,
      levyAmountD: 0,
      levyAmountE: 0,
      discountAmount: 0,
      exciseAmount: 0,
      batchCode: '',
      unitPrice: '100',
    },
  ],
} satisfies Invoice;

const partialRefund = {
  ...invoice,
  flag: 'PARTIAL_REFUND',
  reference: 'REF-2026-002',
  totalLevy: 112.5,
  totalVat: 337.5,
  totalAmount: 2250,
  items: invoice.items.map((item) => ({
    ...item,
    quantity: '22.50',
    levyAmountA: 56.25,
    levyAmountB: 56.25,
  })),
} satisfies Invoice;

const refundCancellation = {
  invoiceNumber: 'INV-2026-001',
  reference: 'REF-2026-001',
  userName: 'Kofi Ghana',
  flag: 'REFUND_CANCELATION',
  transactionDate: `${date}T12:00:00Z`,
  totalAmount: 4500,
} satisfies Cancellation;

const note = {
  noteNumber: 'CN-2026-001',
  currency: 'GHS',
  exchangeRate: 1,
  noteAmount: 1200,
  calculationType: 'EXCLUSIVE',
  businessPartnerName: 'Cash customer',
  businessPartnerTin: 'C0000000000',
  userName: 'Kofi Ghana',
  flag: 'CREDIT_NOTE',
  groupReferenceId: 'GROUP-2026-001',
  transactionDate: date,
  remarks: 'CN',
  noteLineFlag: 'INVOICE',
  noteLines: [{ invoiceNumber: 'INV-2026-001', invoiceDate: date, invoiceAmount: 4500 }],
} satisfies Note;

const statement = {
  currency: 'GHS',
  exchangeRate: 1,
  totalVat: 675,
  totalAmount: 4500,
  totalLevies: 225,
  userName: 'Kofi Ghana',
  businessPartnerName: 'Cash customer',
  businessPartnerTin: 'C0000000000',
  groupReferenceId: 'GROUP-2026-001',
  transactionDate: `${date}T12:00:00Z`,
  calculationType: 'EXCLUSIVE',
  groupInvoiceLines: [
    {
      currency: 'GHS',
      exchangeRate: 1,
      calculationType: 'EXCLUSIVE',
      invoiceNumber: 'INV-2026-001',
      reference: '',
      flag: 'INVOICE',
      invoiceVat: 675,
      invoiceAmount: 4500,
      invoiceLevies: 225,
      transactionDate: `${date}T12:00:00Z`,
    },
  ],
} satisfies StatementOfAccount;

const inventory = {
  inventories: [
    {
      code: 'ABT301',
      description: 'Abrokyire Ntomah',
      quantity: 45,
      batchCode: 'BATCH-001',
      unitPrice: 100,
      expiryDate: '2027-01-01',
    },
  ],
  inventoryDate: date,
} satisfies Inventory;

const identification = {
  status: 'SUCCESS',
  data: {
    tin: 'C0000000000',
    type: 'C',
    name: 'MOCK Company Limited',
    sector: 'MOCK retail business',
    address: 'MOCK address, Accra',
  },
};

function receipt(flag: string, number: string, suffix: string, signed = true): GraResponse {
  return {
    response: {
      distributor_tin: 'C0000000000',
      message: {
        num: number,
        ysdcid: 'MOCK-SDC-001',
        ysdcrecnum: `MOCK-${suffix}`,
        ysdcintdata: signed ? 'MOCK-FAKE-INTERNAL-DATA' : '',
        ysdcregsig: signed ? 'MOCK-FAKE-SIGNATURE' : '',
        ysdcmrc: 'MOCK-MACHINE',
        ysdcmrctim: stamp,
        ysdctime: stamp,
        flag,
        ysdcitems: '1',
      },
      qr_code: signed ? `https://mock.invalid/receipt?number=${encodeURIComponent(number)}` : '',
      status: 'SUCCESS',
    },
  };
}

function entry(input: {
  id: string;
  title: string;
  description: string;
  method?: 'GET' | 'POST';
  path: string;
  request?: unknown;
  response: unknown;
  responseLabel?: string;
  responseNote?: string;
}): EndpointReference {
  const method = input.method ?? 'POST';
  const path = `${prefix}/${input.path}`;
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    method,
    path,
    request:
      method === 'GET'
        ? `GET ${path} HTTP/1.1\nsecurity_key: mock\nAccept: application/json`
        : JSON.stringify(input.request, null, 2),
    requestLabel: method === 'GET' ? 'Request, no JSON body' : 'Request JSON',
    response: JSON.stringify(input.response, null, 2),
    responseLabel: input.responseLabel ?? 'Mock response example',
    responseNote: input.responseNote ?? mockResponseNote,
  };
}

/** Static examples stay available even when the local mock is unreachable. */
export const API_REFERENCE: readonly EndpointReference[] = [
  entry({
    id: 'invoice',
    title: 'Invoice',
    description:
      'Issue a normal sale with INVOICE. totalAmount is the sum of unitPrice × quantity before tax for EXCLUSIVE pricing.',
    path: 'invoice',
    request: invoice,
    response: receipt('INVOICE', 'INV-2026-001', 'NS1'),
  }),
  entry({
    id: 'refund',
    title: 'Full refund',
    description:
      'Use the original invoiceNumber and a unique refund reference. REFUND cancels the entire sale.',
    path: 'invoice',
    request: { ...invoice, flag: 'REFUND', reference: 'REF-2026-001' },
    response: receipt('REFUND', 'REF-2026-001', 'NR1'),
  }),
  entry({
    id: 'partial-refund',
    title: 'Partial refund',
    description:
      'Return selected quantities with PARTIAL_REFUND. The documented response reports REFUND in its message flag.',
    path: 'invoice',
    request: partialRefund,
    response: receipt('REFUND', 'REF-2026-002', 'NR2'),
  }),
  entry({
    id: 'refund-cancellation',
    title: 'Refund cancellation',
    description:
      'Reverse a prior refund. Preserve the single-L flag REFUND_CANCELATION from the documented request.',
    path: 'cancellation',
    request: refundCancellation,
    response: { status: 'SUCCESS' },
    responseLabel: 'Mock-only acknowledgement',
    responseNote: unknownResponseNote,
  }),
  entry({
    id: 'purchase',
    title: 'Purchase',
    description:
      'Register a purchase with PURCHASE. Documented purchase receipts have empty signature and QR fields.',
    path: 'invoice',
    request: { ...invoice, invoiceNumber: 'BILL-2026-001', flag: 'PURCHASE' },
    response: receipt('PURCHASE', 'BILL-2026-001', 'NP1', false),
  }),
  entry({
    id: 'purchase-return',
    title: 'Purchase return',
    description:
      'Return goods against the original purchase invoiceNumber and identify the return with its reference.',
    path: 'invoice',
    request: {
      ...invoice,
      invoiceNumber: 'BILL-2026-001',
      flag: 'PURCHASE_RETURN',
      reference: 'PR-2026-001',
    },
    response: receipt('PURCHASE_RETURN', 'BILL-2026-001', 'NT1', false),
  }),
  entry({
    id: 'purchase-return-cancellation',
    title: 'Purchase return cancellation',
    description:
      'Reverse a purchase return with PURCHASE_RETURN_CANCELATION, using the exact spelling in the Postman request.',
    path: 'cancellation',
    request: {
      ...refundCancellation,
      invoiceNumber: 'BILL-2026-001',
      reference: 'PR-2026-001',
      flag: 'PURCHASE_RETURN_CANCELATION',
    },
    response: { status: 'SUCCESS' },
    responseLabel: 'Mock-only acknowledgement',
    responseNote: unknownResponseNote,
  }),
  entry({
    id: 'credit-note',
    title: 'Credit note',
    description:
      'Submit the documented CREDIT_NOTE request. The collection does not define a DEBIT_NOTE flag despite the folder title.',
    path: 'note',
    request: note,
    response: { status: 'SUCCESS' },
    responseLabel: 'Mock-only acknowledgement',
    responseNote: unknownResponseNote,
  }),
  entry({
    id: 'statement-of-account',
    title: 'Statement of account',
    description:
      'Group invoice lines under one reference. Keep statment_of_account exactly as spelled in the documented URL.',
    path: 'statment_of_account',
    request: statement,
    response: { status: 'SUCCESS' },
    responseLabel: 'Mock-only acknowledgement',
    responseNote: unknownResponseNote,
  }),
  entry({
    id: 'health',
    title: 'Health check',
    description: 'Check availability of the authenticated taxpayer endpoint.',
    method: 'GET',
    path: 'health',
    response: { status: 'UP' },
    responseLabel: 'Documented response',
    responseNote: 'This response body is shown directly in the Postman collection.',
  }),
  entry({
    id: 'tin',
    title: 'TIN lookup',
    description:
      'Look up a taxpayer identity. This path appears in the TinDetails response example’s originalRequest.',
    method: 'GET',
    path: 'identification/tin/C0000000000',
    response: identification,
    responseNote:
      'The response follows the documented shape. All identity values here are synthetic mock data.',
  }),
  entry({
    id: 'ghana-card',
    title: 'Ghana Card lookup',
    description: 'Look up an identity using the nationalId path and the Ghana Card PIN format.',
    method: 'GET',
    path: 'identification/nationalId/GHA-123456789-0',
    response: identification,
    responseNote:
      'The response follows the documented shape. All identity values here are synthetic mock data.',
  }),
  entry({
    id: 'inventory',
    title: 'Inventory',
    description:
      'Upload a dated inventory snapshot. Inventory expiryDate differs from invoice item expireDate.',
    path: 'inventory',
    request: inventory,
    response: { status: 'SUCCESS' },
    responseLabel: 'Documented response',
    responseNote: 'This response body is shown directly in the Postman collection.',
  }),
  entry({
    id: 'callback',
    title: 'Invoice callback',
    description:
      'Recover the stamped receipt after an uncertain submission before resending the invoice.',
    path: 'invoice/callback',
    request: { reference: '', invoiceNumber: 'INV-2026-001', flag: 'INVOICE' },
    response: receipt('INVOICE', 'INV-2026-001', 'NS1'),
  }),
];

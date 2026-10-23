import type { GraResponse, Invoice } from '@gra-evat/core';

/**
 * Format the receipt timestamp exactly as the v8.2 response samples, in UTC (Accra).
 * @example
 * receiptTimestamp(new Date('2026-01-01T12:30:00Z')); // '2026/01/01 12:30:00'
 */
export function receiptTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ').replaceAll('-', '/');
}

function mockHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

/**
 * Make a conspicuously fake signature. This never contacts GRA or creates a legal receipt.
 * @example
 * const receipt = signMockInvoice(invoice, 'C0000000000-001', 1, 'test', new Date('2026-01-01Z'));
 */
export function signMockInvoice(
  invoice: Invoice,
  taxpayerId: string,
  sequence: number,
  seed: string,
  date: Date,
): GraResponse {
  const purchase = invoice.flag === 'PURCHASE' || invoice.flag === 'PURCHASE_RETURN';
  const refund = invoice.flag === 'REFUND' || invoice.flag === 'PARTIAL_REFUND';
  const code = purchase ? (invoice.flag === 'PURCHASE' ? 'NP' : 'NT') : refund ? 'NR' : 'NS';
  const receiptNumber = `MOCK-${mockHash(seed).slice(0, 4)}-${code}${sequence}`;
  const digest = mockHash(`${seed}:${taxpayerId}:${sequence}:${JSON.stringify(invoice)}`);
  const timestamp = receiptTimestamp(date);
  return {
    response: {
      distributor_tin: taxpayerId.replace(/-[^-]*$/, ''),
      message: {
        num: refund ? (invoice.reference ?? invoice.invoiceNumber) : invoice.invoiceNumber,
        ysdcid: 'MOCK-SDC-001',
        ysdcrecnum: receiptNumber,
        ysdcintdata: purchase ? '' : `MOCK-DATA-${digest}`,
        ysdcregsig: purchase ? '' : `MOCK-${digest}-FAKE`,
        ysdcmrc: 'MOCK-00-00-00-00-00',
        ysdcmrctim: timestamp,
        ysdctime: timestamp,
        flag: invoice.flag === 'PARTIAL_REFUND' ? 'REFUND' : invoice.flag,
        ysdcitems: String(invoice.items.length),
      },
      // ASSUMPTION: the opaque real QR encryption is undocumented; reserved .invalid URLs make this mock unmistakable.
      qr_code: purchase
        ? ''
        : `https://mock.gra-evat.invalid/receipt?mock=true&invoice=${encodeURIComponent(invoice.invoiceNumber)}&receipt=${encodeURIComponent(receiptNumber)}`,
      status: 'SUCCESS',
    },
  };
}

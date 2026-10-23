import { createInvoice, parseMoney, type Invoice } from '@gra-evat/core';

/**
 * A synthetic 2026 standard-rated invoice, never a real business identity.
 * @example
 * import { createSampleInvoice } from '@gra-evat/mock';
 * const invoice = createSampleInvoice('DEMO-001');
 * console.log(invoice.totalAmount); // '4500.00'
 */
export function createSampleInvoice(invoiceNumber = 'MOCK-INV-001'): Invoice {
  return createInvoice({
    invoiceNumber,
    transactionDate: '2026-01-01',
    userName: 'Mock cashier',
    businessPartnerName: 'Mock cash customer',
    businessPartnerTin: 'C0000000000',
    calculationType: 'EXCLUSIVE',
    items: [
      {
        itemCode: 'ABT301',
        description: 'Abrokyire Ntomah',
        quantity: '45',
        unitPrice: parseMoney('100.00'),
      },
    ],
  });
}

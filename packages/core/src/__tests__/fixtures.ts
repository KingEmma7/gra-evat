import { createInvoice, parseMoney, type GraResponse } from '../index';

export function sampleInvoice() {
  return createInvoice({
    invoiceNumber: 'INV-001',
    transactionDate: '2026-01-01',
    userName: 'Kofi Ghana',
    businessPartnerName: 'Cash customer',
    businessPartnerTin: 'C0000000000',
    calculationType: 'EXCLUSIVE',
    items: [
      {
        itemCode: 'ABT301',
        description: 'Abrokyire Ntomah',
        quantity: '45',
        unitPrice: parseMoney('100'),
      },
    ],
  });
}

export const receipt: GraResponse = {
  response: {
    distributor_tin: 'C0000000000',
    message: {
      num: 'INV-001',
      ysdcid: 'MOCK-SDC',
      ysdcrecnum: 'MOCK-1',
      ysdcintdata: 'MOCK-FAKE',
      ysdcregsig: 'MOCK-FAKE',
      ysdcmrc: 'MOCK',
      ysdcmrctim: '2026/01/01 00:00:00',
      ysdctime: '2026/01/01 00:00:00',
      flag: 'INVOICE',
      ysdcitems: '1',
    },
    qr_code: 'https://example.invalid/mock',
    status: 'SUCCESS',
  },
};

export const cancellation = {
  invoiceNumber: 'INV-001',
  reference: 'REF-1',
  userName: 'Kofi',
  flag: 'REFUND_CANCELATION',
  transactionDate: '2026-01-01',
  totalAmount: '4500.00',
};
export const note = {
  noteNumber: 'CN-1',
  currency: 'GHS',
  exchangeRate: 1,
  noteAmount: '1200.00',
  calculationType: 'EXCLUSIVE',
  businessPartnerName: 'Cash customer',
  businessPartnerTin: 'C0000000000',
  userName: 'Kofi',
  flag: 'CREDIT_NOTE',
  groupReferenceId: '',
  transactionDate: '2026-01-01',
  remarks: 'CN',
  noteLineFlag: 'INVOICE',
  noteLines: [{ invoiceNumber: 'INV-001', invoiceDate: '2026-01-01', invoiceAmount: '4500.00' }],
};
export const statement = {
  currency: 'GHS',
  exchangeRate: 1,
  totalVat: 675,
  totalAmount: 4500,
  totalLevies: 225,
  userName: 'Kofi',
  businessPartnerName: 'Cash customer',
  businessPartnerTin: 'C0000000000',
  groupReferenceId: 'GROUP-1',
  transactionDate: '2026-01-01',
  calculationType: 'EXCLUSIVE',
  groupInvoiceLines: [
    {
      currency: 'GHS',
      exchangeRate: 1,
      calculationType: 'EXCLUSIVE',
      invoiceNumber: 'INV-001',
      flag: 'INVOICE',
      invoiceVat: 675,
      invoiceAmount: 4500,
      invoiceLevies: 225,
      transactionDate: '2026-01-01',
    },
  ],
};
export const inventory = {
  inventoryDate: '2026-01-01',
  inventories: [
    {
      code: 'SKU-1',
      description: 'Book',
      quantity: 1,
      batchCode: '',
      unitPrice: 100,
      expiryDate: '2027-01-01',
    },
  ],
};
export const identification = {
  status: 'SUCCESS',
  data: { tin: 'C0000000000', type: 'C', name: 'Mock Company', sector: 'Retail', address: 'Accra' },
};

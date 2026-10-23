import { createClient, createInvoice, parseMoney } from '@gra-evat/core';

const client = createClient({
  baseUrl: process.env.GRA_BASE_URL ?? 'http://localhost:8787',
  credentials: {
    securityKey: process.env.GRA_SECURITY_KEY ?? 'mock',
    taxpayerId: process.env.GRA_TAXPAYER_ID ?? 'C0000000000-001',
  },
  retries: 0,
});
const invoice = createInvoice({
  invoiceNumber: `NODE-${Date.now()}`,
  transactionDate: new Date().toISOString().slice(0, 10),
  userName: 'Demo cashier',
  businessPartnerName: 'Cash customer',
  businessPartnerTin: 'C0000000000',
  calculationType: 'EXCLUSIVE',
  items: [
    {
      itemCode: 'COFFEE-01',
      description: 'Coffee',
      quantity: '2',
      unitPrice: parseMoney('25.00'),
    },
  ],
});
const result = await client.invoice(invoice);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

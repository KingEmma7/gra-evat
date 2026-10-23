import {
  calculateInvoice,
  createInvoice,
  parseMoney,
  pesewas,
  type Invoice,
  type Pesewas,
} from '@gra-evat/core';

export type DraftLine = {
  id: string;
  code: string;
  description: string;
  quantity: string;
  price: string;
  discount: string;
  exempt: boolean;
};

export type Draft = {
  businessName: string;
  businessTin: string;
  branch: string;
  customerName: string;
  customerTin: string;
  customerPhone: string;
  invoiceNumber: string;
  transactionDate: string;
  userName: string;
  calculationType: 'INCLUSIVE' | 'EXCLUSIVE';
  items: DraftLine[];
};

export const currency = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' });

export function money(value: number): string {
  return currency.format(value / 100);
}

export function newLine(index: number, existing: readonly DraftLine[] = []): DraftLine {
  const codes = new Set(existing.map((item) => item.code));
  let nextIndex = index;
  while (codes.has(`ITEM-${String(nextIndex).padStart(3, '0')}`)) nextIndex++;
  return {
    id: crypto.randomUUID(),
    code: `ITEM-${String(nextIndex).padStart(3, '0')}`,
    description: '',
    quantity: '1',
    price: '',
    discount: '0.00',
    exempt: false,
  };
}

export function initialDraft(): Draft {
  return {
    businessName: 'Accra Trading Co.',
    businessTin: 'C0000000000',
    branch: '001',
    customerName: 'Cash customer',
    customerTin: 'C0000000000',
    customerPhone: '',
    invoiceNumber: 'INV-2026-0001',
    transactionDate: new Date().toISOString().slice(0, 10),
    userName: 'Kofi Ghana',
    calculationType: 'EXCLUSIVE',
    items: [],
  };
}

export function sampleLines(): DraftLine[] {
  return [
    {
      id: crypto.randomUUID(),
      code: 'AC-001',
      description: 'Handwoven market basket',
      quantity: '2',
      price: '100.00',
      discount: '0.00',
      exempt: false,
    },
    {
      id: crypto.randomUUID(),
      code: 'AC-002',
      description: 'Glazed ceramic bowl',
      quantity: '1',
      price: '75.00',
      discount: '0.00',
      exempt: false,
    },
  ];
}

export function calculationItems(items: DraftLine[]) {
  return items.map((item) => ({
    itemCode: item.code,
    description: item.description,
    quantity: item.quantity,
    unitPrice: parseMoney(item.price),
    discountAmount: parseMoney(item.discount || '0'),
    itemCategory: item.exempt ? ('EXM' as const) : ('' as const),
  }));
}

export function buildDraft(draft: Draft): Invoice {
  return createInvoice({
    invoiceNumber: draft.invoiceNumber,
    transactionDate: draft.transactionDate,
    userName: draft.userName,
    businessPartnerName: draft.customerName || 'Cash customer',
    businessPartnerTin: draft.customerTin || 'C0000000000',
    calculationType: draft.calculationType,
    items: calculationItems(draft.items),
  });
}

export function preview(draft: Draft) {
  return calculateInvoice(calculationItems(draft.items), draft.calculationType);
}

// Quantities use six decimal places. Money allocation remains integer arithmetic.
export function quantityUnits(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value))
    throw new Error('Enter a positive quantity with at most 6 decimal places.');
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

export function quantityDecimal(units: bigint): string {
  if (units < 0n) throw new Error('Quantity cannot be negative.');
  const whole = units / 1_000_000n;
  const fraction = String(units % 1_000_000n)
    .padStart(6, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function proportionalDiscount(discount: Pesewas, selected: string, sold: string): Pesewas {
  const denominator = quantityUnits(sold);
  const numerator = BigInt(discount) * quantityUnits(selected);
  if (denominator === 0n) return pesewas(0);
  return pesewas(Number((numerator * 2n + denominator) / (denominator * 2n)));
}

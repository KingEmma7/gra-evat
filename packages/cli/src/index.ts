#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { calculateInvoice, formatMoney, parseMoney, validateInvoice } from '@gra-evat/core';

const help = `gra-evat: local GRA E-VAT developer tools

  gra-evat validate invoice.json
  gra-evat calc --price 100 --inclusive
  gra-evat calc --price 100 --quantity 2 --discount 5 --exempt

Prices and discounts are decimal GHS amounts. Discounts apply per line.
Calculator uses the 2026 standard rates. This is not tax advice.
`;

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(help);
    return;
  }
  if (command === 'validate') {
    if (rest.length !== 1 || !rest[0]) throw new Error('Usage: gra-evat validate invoice.json');
    const input: unknown = JSON.parse(await readFile(rest[0], 'utf8'));
    const result = validateInvoice(input);
    if (!result.ok) {
      process.stderr.write(
        JSON.stringify({ valid: false, issues: result.error.issues }, null, 2) + '\n',
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `Valid E-VAT ${result.data.flag} payload (${result.data.items.length} lines).\n`,
    );
    return;
  }
  if (command === 'calc') {
    const options = new Map<string, string>();
    let inclusive = false;
    let exempt = false;
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      if (arg === '--inclusive') inclusive = true;
      else if (arg === '--exempt') exempt = true;
      else if (arg && ['--price', '--quantity', '--discount'].includes(arg)) {
        const value = rest[++index];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
        if (options.has(arg)) throw new Error(`Repeated option ${arg}`);
        options.set(arg, value);
      } else throw new Error(`Unknown option: ${arg ?? ''}`);
    }
    const price = options.get('--price');
    if (price === undefined) throw new Error('Required: --price, for example --price 100');
    const totals = calculateInvoice(
      [
        {
          unitPrice: parseMoney(price),
          quantity: options.get('--quantity') ?? '1',
          discountAmount: parseMoney(options.get('--discount') ?? '0'),
          itemCategory: exempt ? 'EXM' : '',
        },
      ],
      inclusive ? 'INCLUSIVE' : 'EXCLUSIVE',
    );
    const output = {
      currency: 'GHS',
      calculationType: inclusive ? 'INCLUSIVE' : 'EXCLUSIVE',
      subtotal: formatMoney(totals.subtotal),
      nhil: formatMoney(totals.nhil),
      getfund: formatMoney(totals.getfund),
      vat: formatMoney(totals.vat),
      total: formatMoney(totals.total),
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return;
  }
  throw new Error(`Unknown command: ${command}. Run gra-evat --help.`);
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
});

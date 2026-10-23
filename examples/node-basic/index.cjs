const { calculateInvoice, parseMoney, formatMoney } = require('@gra-evat/core');
const result = calculateInvoice([{ unitPrice: parseMoney('100'), quantity: '1' }], 'EXCLUSIVE');
console.log(`GHS ${formatMoney(result.total)}`);

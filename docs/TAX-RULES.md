# Tax rules

Rule version: `GH-2026-01-01`. Effective date: 1 January 2026.

For standard supplies, VAT is 15%, NHIL is 2.5%, and GETFund is 2.5%. Each applies to the same taxable base. VAT is not compounded on the two levies. The COVID levy is abolished for this rule version. GRA's example gives a GHS 1,000 base, GHS 25 NHIL, GHS 25 GETFund, GHS 150 VAT, and a GHS 1,200 total. Sources: [GRA VAT guidance](https://gra.gov.gh/domestic-tax/tax-types/vat/), [implementation notice](https://gra.gov.gh/news/portfolio/notice-to-all-vat-registered-taxpayers/), and [implementation guidelines](https://gra.gov.gh/wp-content/uploads/2026/01/VAT-Guidelines-for-VAT-ACT-1151.pdf).

The Postman v8.2 invoice example supplies 45 units at GHS 100 exclusive: `totalAmount: 4500`, `totalLevy: 225`, and `totalVat: 675`. `totalAmount` means the sum of unit price times quantity in the chosen pricing mode. For an exclusive invoice it is **not** the customer's tax-inclusive payable amount.

## Integer policy

`config.ts` stores effective-dated rate data and the computation method. Monetary values use safe integer pesewas and BigInt intermediates. Decimal quantity strings are parsed as rational integers. Conversion to API decimal strings happens at the boundary. Floating point is used only for display formatting, never monetary calculations.

Round half up to the nearest pesewa at each line. Sum rounded line results for invoice totals. For inclusive pricing, retain the entered gross amount, derive the base by dividing by 1.20, round NHIL and GETFund independently, and assign the residual to VAT. This reconciles every line. Tiny inclusive amounts can therefore have a VAT value that differs from independently rounding 15% of the rounded base. GRA's public material does not prescribe this pesewa allocation; verify it during onboarding.

Discounts supported by the convenience builder are `GENERAL` line discounts that reduce the taxable amount. The source's wording for `SELECTIVE` and `GENERAL` is ambiguous. Do not infer additional tax treatment. See the explicit limits and assumptions in [ASSUMPTIONS.md](ASSUMPTIONS.md).

`EXM` is the API's combined exempt/zero-rated category. The calculator uses zero VAT and levies for it; the wire format cannot distinguish these two treatments. Other documented item categories are accepted by raw schemas, but the convenience calculator does not guess their tax bases. Dates before 2026 are rejected by the 2026 convenience builder. The SDK does not silently apply 2026 rules to historical invoices.

## Custom configurations

Use a separate effective-dated rule object for any change. Verify rates, base, categories, discount and rounding behavior against official material and real sandbox examples before using it in production. Changing a rate alone does not establish compliance.

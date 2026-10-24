# @gra-evat/core

Typed GRA E-VAT v8.2 schemas, validator, fetch client and integer 2026 levy calculator. Zod 4.6.6 is the only runtime dependency. Supports ESM and CommonJS, with declaration exports for both.

Use `createInvoice` with pesewas from `parseMoney`, then call `createClient(...).invoice`. See the repository README for a complete example, API.md for exact paths and fields, and ASSUMPTIONS.md for local policies. Retries default to zero. Use callback reconciliation before resending uncertain mutations.

Not affiliated with GRA. Not tax advice. Mock results are not certification. Keep real credentials server-side.

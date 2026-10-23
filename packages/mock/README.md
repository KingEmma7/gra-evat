# @gra-evat/mock

A local and browser E-VAT simulator for development. **Every signature is fake. No request is sent to GRA. Receipts have no fiscal validity.**

From this repository:

```sh
pnpm build:packages
pnpm --filter @gra-evat/mock start
```

The default server listens on `127.0.0.1:8787`. Set `HOST=0.0.0.0` explicitly when running in a container. Requests use the exact documented route prefix and `security_key: mock`:

```sh
curl -H 'security_key: mock' \
  http://localhost:8787/vsdc/api/v1/taxpayer/C0000000000-001/health
# {"status":"UP"}
```

Configure `MOCK_SEED=demo` for stable receipt timestamps and signatures, `MOCK_LATENCY_MS=250` for latency, or `MOCK_FAIL_STATUS=503` for repeatable errors. A `?fail=500` or `?fail=429` query overrides the failure setting. The latter includes `Retry-After: 1`. Invalid payloads and duplicate identifiers return the documented `{timestamp,status,error}` envelope. All responses include `X-Gra-Evat-Mock: true`. Request logs omit request bodies, credentials and identifying URL segments.

```ts
import { createClient } from '@gra-evat/core';
import { createMockFetch, createSampleInvoice } from '@gra-evat/mock';

// Create once. Prior invoices and refund quantities live in this transport.
const client = createClient({
  baseUrl: 'https://mock.gra-evat.invalid',
  credentials: { securityKey: 'mock', taxpayerId: 'C0000000000-001' },
  fetch: createMockFetch({ seed: 'demo', latencyMs: 100 }),
});
console.log(await client.invoice(createSampleInvoice('DEMO-001')));
```

The root package entry is browser safe. The Node server has a separate executable entry and is never pulled into the hosted playground. `createMockApp(options)` exposes the same Hono routes for integration tests and alternate adapters. Both transports use the same validation, storage and receipt logic.

The state model isolates taxpayers. `invoiceNumber` locates an original invoice or purchase. A refund's `reference` is a unique refund identifier. Full refunds reverse all remaining units and close the transaction. Cancelling a refund restores those quantities. Partial refunds aggregate exact quantities across prior active refunds, and must preserve original prices, tax categories, currency and pricing mode. Purchases and purchase returns have empty signatures and QR strings, matching the documented samples.

The mock also caps cumulative refund money, tax and discounts at the original amounts. Returning the last remaining units must reconcile those amounts exactly. Independent rounding across several refunds can otherwise over-credit or under-credit a pesewa. If that happens, the mock rejects the final refund with a rounding error. Cancel the earlier refunds and issue one consolidated refund. This is an explicit local policy because v8.2 does not specify a refund rounding-allocation mechanism or adjustment field. For the cap, payable is gross less discount, with VAT, levies and excise added for exclusive prices. Vouchers are treated as tender. These rules use exact integer amounts.

Cancellation, note and account success responses are undocumented in v8.2. The mock's `{status:'SUCCESS'}` acknowledgements and refund reference convention are explicit assumptions in the repository's `docs/ASSUMPTIONS.md`. Fake QR URLs use the reserved `.invalid` domain. Identity lookups return synthetic records and never query official identity systems.

There is no database. Restarting the server or recreating `createMockFetch` clears all state. Use the mock for local development and testing, never as an invoice certification service.

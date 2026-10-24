# SDK, CLI and mock usage

Start with the [local quickstart](../README.md#ten-minute-quickstart). These examples use synthetic invoices and the literal `mock` key.

## SDK

After publication: `npm install @gra-evat/core`. For local package testing, run `pnpm --dir packages/core pack` and install the resulting archive in your application.

```ts
import { createClient, createInvoice, parseMoney } from '@gra-evat/core';

const client = createClient({
  baseUrl: 'http://localhost:8787',
  credentials: { securityKey: 'mock', taxpayerId: 'C0000000000-001' },
  retries: 0,
});

const invoice = createInvoice({
  invoiceNumber: 'POS-0001',
  transactionDate: '2026-10-23',
  userName: 'Demo cashier',
  businessPartnerName: 'Cash customer',
  businessPartnerTin: 'C0000000000',
  calculationType: 'EXCLUSIVE',
  items: [
    { itemCode: 'COFFEE-01', description: 'Coffee', quantity: '2', unitPrice: parseMoney('25.00') },
  ],
});

const result = await client.invoice(invoice);
if (result.ok) console.log(result.data.response.message.ysdcrecnum);
else console.error(result.error);

// Same operation, with typed exceptions:
// const receipt = await client.throwing.invoice({ ...invoice, invoiceNumber: 'POS-0002' });
```

Run `pnpm check:size` for the current core ESM and gzip sizes, excluding external Zod.

Core has one runtime dependency, Zod 4.6.6. Money stays in branded integer pesewas; quantity multiplication and rates use integer rational arithmetic. `formatMoney` returns an exact decimal string at the API boundary. Monetary JSON accepts the documented numeric values and numeric strings. Use `Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' })` for display only.

Exported schemas and the schema arguments to `validateSchema` and `schemaIssues` now use Zod 4. Raw `.safeParse().error.issues` codes, custom schemas and Zod methods follow the [Zod 4 migration guide](https://zod.dev/v4/changelog). The SDK preserves its `ValidationIssue` fields and the tested JSON diagnostics, including mock HTTP validation text. JavaScript `Infinity` remains invalid but now aborts numeric unions earlier, so its diagnostic text can differ; JSON cannot represent it. The SDK's constrained arrays reject excess items before traversing elements. Apply explicit size limits to any custom collections.

See [API.md](API.md) for paths, fields and operation names, [TAX-RULES.md](TAX-RULES.md) for the versioned rules and rounding policy, and [ASSUMPTIONS.md](ASSUMPTIONS.md) for every local policy and undocumented response.

### Retry and idempotency

Retries default to zero because the documented mutation endpoints provide no idempotency key contract. A lost response may mean the invoice was already accepted. Use `client.callback` with the original identifiers to retrieve a stamped invoice before deciding whether to resend it. Never create a new invoice number solely to get around a duplicate response.

When explicitly enabled, retries apply only to network errors, HTTP 429 and 5xx responses. Backoff uses jitter and honors `Retry-After`. Ordinary 4xx responses and schema errors are returned immediately. An AbortController bounds each attempt. Timeouts represent an unknown mutation outcome; reconcile before retrying.

### Switching to real GRA

Obtain credentials and the approved API origin from GRA, then change the configuration values. The client constructs `/vsdc/api/v1/taxpayer/{taxpayerId}/...` under that origin. Do not include this prefix twice.

```ts
const client = createClient({
  baseUrl: process.env.GRA_BASE_URL!,
  credentials: {
    taxpayerId: process.env.GRA_TAXPAYER_ID!,
    securityKey: process.env.GRA_SECURITY_KEY!,
  },
});
```

Keep real credentials on your server. The public playground only supports mock credentials. The server-only Next.js example lives in [examples/nextjs-route-handler/route.ts](../examples/nextjs-route-handler/route.ts). Cloud integration still requires GRA onboarding and contract verification. A successful mock test is not certification.

Bun, Deno, browsers and edge runtimes can use the ESM core with their `fetch`, or inject a Fetch-compatible implementation. Only the CLI and Hono Node server require Node. Automated runtime checks are described in [VERIFICATION.md](VERIFICATION.md).

## CLI

```sh
pnpm cli validate examples/invoice.json
pnpm cli calc --price 100 --inclusive
```

The inclusive example prints base `83.33`, NHIL `2.08`, GETFund `2.08`, VAT `12.51`, and total `100.00`. The last pesewa is allocated to VAT so totals reconcile under the documented local rounding assumption. Invalid payloads exit with code 1 and list all discovered field issues and fix hints.

## Mock server

```sh
pnpm build:packages
pnpm --filter @gra-evat/mock start
```

The default key is `mock`, the API prefix is `/vsdc/api/v1/taxpayer/C0000000000-001`, and health is `/health` beneath that prefix. All endpoints require `security_key: mock`. Signatures and QR payloads are unmistakably fake; the QR URL uses a reserved `.invalid` domain.

Configure `PORT` (8787), `MOCK_LATENCY_MS`, `MOCK_FAIL_STATUS`, and `MOCK_SEED`. Use `?fail=500` or `?fail=429` on any endpoint to inject an HTTP error. See mock options in [packages/mock](../packages/mock/README.md) for deterministic and browser use. A matching original transaction must exist before a refund or return is accepted. State is isolated by taxpayer identifier.

## Deployment and releases

For Vercel, set the project root to `apps/playground`, enable access to workspace files, install from the monorepo root, and run the package builds before `next build`. Browser mock mode is the hosted default and needs no deployed API. `NEXT_PUBLIC_GRA_BASE_URL` configures the optional local mock origin; never place a real security key in a `NEXT_PUBLIC_` variable.

The optional [Dockerfile](../packages/mock/Dockerfile) serves only the mock. Build from the repository root with `docker build -f packages/mock/Dockerfile -t gra-evat-mock .`. It contains no credentials and no persistent store. Configure network access for your deployment deliberately.

Changesets manage versions and changelogs. The release workflow is prepared for an upstream repository with npm publishing credentials, GitHub release permissions, provenance, and a protected `npm` environment. Configure repository metadata and verify package-name ownership before enabling release. No package or site is published as part of this build.

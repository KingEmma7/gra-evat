# gra-evat

![License: MIT](https://img.shields.io/badge/license-MIT-173f35)
![Node 20.19+](https://img.shields.io/badge/node-20.19%2B-173f35)
![API v8.2](https://img.shields.io/badge/GRA_API-v8.2-c89d3c)
![Status: local development](https://img.shields.io/badge/status-local_development-c89d3c)

A typed TypeScript SDK, stateful mock server, CLI, and accessible web playground for Ghana E-VAT developers.

Build an invoice against a local simulator, inspect the exact v8.2 JSON, then configure the SDK with your GRA endpoint and credentials. All demo receipts carry fake signatures. This project is not affiliated with GRA, is not tax advice, and must be verified against official GRA documentation.

This source project is ready for package publication review. The npm packages have **not** been published. Until publication, use the workspace commands below or install a locally packed archive.

The web interface is a monochrome reference manual. It uses local IBM Plex fonts, a 240px desktop navigation column, and a 720px content column. Every documented operation has independently copyable request and response examples, displayed side by side on desktop. See [DESIGN.md](docs/DESIGN.md) for screenshots and the layout audit.

## Ten-minute quickstart

Requirements: Node 20.19+ (or a compatible newer LTS) and pnpm 9.15.9. With Corepack, run `corepack prepare pnpm@9.15.9 --activate`. Alternatively install `pnpm@9.15.9` with npm.

From this repository:

```sh
pnpm install
pnpm dev
```

Expected services:

- Playground: [http://localhost:3000](http://localhost:3000)
- Local mock: [http://localhost:8787](http://localhost:8787)

Open the playground, select **Invoice builder** in the manual navigation, choose **Load sample invoice**, and issue a demo receipt. The default browser simulator works without a backend and keeps state in memory. Select local server mode to use the separately running Hono server. Refreshing the page resets browser receipts; restarting the server resets server receipts.

Issue an invoice from Node:

```sh
pnpm --filter @gra-evat/example-node-basic start
```

Expected result: a JSON result with `ok: true`, `response.status: "SUCCESS"`, and a signature containing `MOCK`. Run the CommonJS calculator with `pnpm --filter @gra-evat/example-node-basic start:cjs`; it prints `GHS 120.00`.

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

The measured core ESM entry is **40,389 bytes**, or **10,017 bytes gzipped** (9.78 KiB), excluding external Zod.

Core has one runtime dependency, Zod 3. Money stays in branded integer pesewas; quantity multiplication and rates use integer rational arithmetic. `formatMoney` returns an exact decimal string at the API boundary. Monetary JSON accepts the documented numeric values and numeric strings. Use `Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' })` for display only.

See [API.md](docs/API.md) for paths, fields and operation names, [TAX-RULES.md](docs/TAX-RULES.md) for the versioned rules and rounding policy, and [ASSUMPTIONS.md](docs/ASSUMPTIONS.md) for every local policy and undocumented response.

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

Keep real credentials on your server. The public playground only supports mock credentials. The server-only Next.js example lives in [examples/nextjs-route-handler/route.ts](examples/nextjs-route-handler/route.ts). Cloud integration still requires GRA onboarding and contract verification. A successful mock test is not certification.

Bun, Deno, browsers and edge runtimes can use the ESM core with their `fetch`, or inject a Fetch-compatible implementation. Only the CLI and Hono Node server require Node. Automated runtime checks are described in [VERIFICATION.md](docs/VERIFICATION.md).

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

Configure `PORT` (8787), `MOCK_LATENCY_MS`, `MOCK_FAIL_STATUS`, and `MOCK_SEED`. Use `?fail=500` or `?fail=429` on any endpoint to inject an HTTP error. See mock options in [packages/mock](packages/mock/README.md) for deterministic and browser use. A matching original transaction must exist before a refund or return is accepted. State is isolated by taxpayer identifier.

## Development commands

| Command               | Expected result                                                   |
| --------------------- | ----------------------------------------------------------------- |
| `pnpm dev`            | Build packages, start mock :8787 and playground :3000             |
| `pnpm test`           | Unit and property tests pass                                      |
| `pnpm test:coverage`  | Core line coverage at least 90%                                   |
| `pnpm test:e2e`       | Chromium invoice, refund and error flows with axe checks          |
| `pnpm build`          | ESM, CJS, declarations, and production Next.js app                |
| `pnpm lint`           | Zero ESLint errors and Prettier differences                       |
| `pnpm typecheck`      | Zero strict TypeScript errors                                     |
| `pnpm check:packages` | publint and Are the Types Wrong pass for all publishable packages |
| `pnpm check:size`     | Core ESM and gzipped entry sizes, external Zod excluded           |

Run `pnpm exec playwright install chromium` once before browser tests. Package declarations must exist before the first typecheck, so run `pnpm build:packages` after installation. The CI workflow follows that order on Node 20 and 22. See [VERIFICATION.md](docs/VERIFICATION.md) for measured results and limitations.

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for Vercel settings, container commands, release setup and font licenses.

## Deployment and releases

For Vercel, set the project root to `apps/playground`, enable access to workspace files, install from the monorepo root, and run the package builds before `next build`. Browser mock mode is the hosted default and needs no deployed API. `NEXT_PUBLIC_GRA_BASE_URL` configures the optional local mock origin; never place a real security key in a `NEXT_PUBLIC_` variable.

The optional [Dockerfile](packages/mock/Dockerfile) serves only the mock. Build from the repository root with `docker build -f packages/mock/Dockerfile -t gra-evat-mock .`. It contains no credentials and no persistent store. Configure network access for your deployment deliberately.

Changesets manage versions and changelogs. The release workflow is prepared for an upstream repository with npm publishing credentials or trusted publishing, GitHub release permissions, provenance, and a protected `npm` environment. Configure repository metadata and verify package-name ownership before enabling release. No package or site is published as part of this build.

## Non-goals

- Real GRA certification or a claim of legal or tax advice.
- On-premise/VSDC device lifecycle or XML formats.
- Shopify, WooCommerce or other platform plugins.
- Persistence, a database, playground authentication or multi-tenant hosting.

## Sources and contribution

The contract is derived from [GRA E-VAT API v8.2 Postman documentation](https://documenter.getpostman.com/view/29809098/2sBXVeGCzK), retrieved 23 October 2026. Rates and the shared taxable base are checked against [GRA's 2026 VAT guidance](https://gra.gov.gh/domestic-tax/tax-types/vat/) and [the effective-date notice](https://gra.gov.gh/news/portfolio/notice-to-all-vat-registered-taxpayers/).

Read [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE).

# gra-evat

![License: MIT](https://img.shields.io/badge/license-MIT-111111?style=flat-square)
![Node 20.19+](https://img.shields.io/badge/node-20.19%2B-111111?style=flat-square)
![API v8.2](https://img.shields.io/badge/GRA_API-v8.2-6B6B6B?style=flat-square)

A typed TypeScript SDK, stateful mock server, CLI, and accessible web playground for Ghana E-VAT developers.

**[Open the live playground](https://gra-evat.etagbor.workers.dev/)** to try the in-browser mock without installing anything. Receipts and signatures are simulated; no real tax invoice is submitted.

Build an invoice against a local simulator, inspect the exact v8.2 JSON, then configure the SDK with your GRA endpoint and credentials. All demo receipts carry fake signatures. This project is not affiliated with GRA, is not tax advice, and must be verified against official GRA documentation.

The npm packages have **not** been published. Use the workspace commands below or install a [locally packed archive](docs/USAGE.md#sdk). Public source availability does not imply npm publication or GRA certification.

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

## Choose a guide

- [SDK, CLI and mock examples](docs/USAGE.md), including retries, refunds, local package archives and real-server configuration.
- [API contract](docs/API.md), [tax rules](docs/TAX-RULES.md) and [documented assumptions](docs/ASSUMPTIONS.md).
- [Measured verification and limits](docs/VERIFICATION.md), [deployment](docs/DEPLOYMENT.md) and [interface design](docs/DESIGN.md).

## Help and contribute

[Report a bug or suggest a feature](https://github.com/KingEmma7/gra-evat/issues/new/choose). Include your runtime, package version, expected result and a small synthetic reproduction. Never post live GRA keys or taxpayer records. Use [private reporting](SECURITY.md) for security issues.

New contributors can start with [good first issues](https://github.com/KingEmma7/gra-evat/labels/good%20first%20issue). Read the [contribution guide](CONTRIBUTING.md), describe your intended change on the issue, and open a focused pull request. Documentation, examples and reproducible bug reports are useful contributions.

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

## Non-goals

- Real GRA certification or a claim of legal or tax advice.
- On-premise/VSDC device lifecycle or XML formats.
- Shopify, WooCommerce or other platform plugins.
- Persistence, a database, playground authentication or multi-tenant hosting.

## Sources and contribution

The contract is derived from [GRA E-VAT API v8.2 Postman documentation](https://documenter.getpostman.com/view/29809098/2sBXVeGCzK), retrieved 23 October 2026. Rates and the shared taxable base are checked against [GRA's 2026 VAT guidance](https://gra.gov.gh/domestic-tax/tax-types/vat/) and [the effective-date notice](https://gra.gov.gh/news/portfolio/notice-to-all-vat-registered-taxpayers/).

Read [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE).

Third-party redistribution notices are generated with the browser build. See [the licence review](docs/THIRD_PARTY.md).

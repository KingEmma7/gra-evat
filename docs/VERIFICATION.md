# Verification record

Completed 23 October 2026 on macOS with pnpm 9.15.9. The final manual source was checked from a local Git clone using Node 20.20.2. The Node 22.23.4 toolchain, SDK and package checks also passed. The final redesigned manual was then built and its three browser flows were rerun successfully on Node 22.23.4 as well. GitHub Actions is configured for Node 20 and 22 on Ubuntu, but no remote workflow was dispatched because this repository has no upstream configured.

## Results

| Check                              | Result                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Frozen dependency install in clone | Passed, exact lockfile, cached packages                                                                  |
| ESLint and Prettier                | Passed, zero errors or differences                                                                       |
| Strict TypeScript                  | Passed for all packages and playground                                                                   |
| Unit and property tests            | 104 passed across four files (76 core, 28 mock)                                                          |
| Core line coverage                 | 100%, 302 of 302 lines                                                                                   |
| Core branch coverage               | 95.25%, 241 of 253 branches                                                                              |
| Core statement coverage            | 99.08%, 324 of 327 statements                                                                            |
| Core function coverage             | 100%, 70 of 70 functions                                                                                 |
| Production builds                  | ESM, CJS, both declaration formats, Next.js build passed                                                 |
| Browser smoke flows                | 3 passed against the final production manual                                                             |
| Accessibility                      | No serious or critical violations in smoke flows; six separate design scans returned no violations       |
| Package validation                 | publint and Are the Types Wrong passed for core, mock and CLI                                            |
| Standalone package                 | Core packed with pnpm, installed in a temporary app; ESM invoice and CommonJS calculator examples passed |
| CLI                                | Sample JSON validation and inclusive GHS 100 calculator passed                                           |
| API trace review                   | Final request keys, paths, enums, response envelopes and documented typos checked against Postman v8.2   |
| Sensitive example keys             | No Postman security key found in distributed source                                                      |
| Core ESM size                      | 40,389 bytes; gzip 10,017 bytes (9.78 KiB), external Zod excluded                                        |
| Screenshots                        | 53 captured, including all fourteen operation pairs                                                      |

The property suite includes 3,000 inclusive/exclusive round trips and 500 random invoices. Test cases cover half-pesewa rounding, uneven inclusive division, zero and negative quantities, large quantities, zero/1,000/1,001 lines, duplicates, wrong-case enums, TIN policies, optional customer handling, supported currencies, identity changes, dates, retries, Retry-After, timeout bounds and malformed responses.

Mock cases cover each SDK operation, cumulative quantity and money caps, refund of a cancelled sale, partial refunds and cancellations, purchase returns, malformed input, authentication, browser fetch, injected failures, abort and deterministic signing. Independent partial-rounding over-credit and under-credit cases are rejected before mutation.

The browser flows cover invoice composition, inclusive/exclusive calculation, QR receipt, exact submitted request/response, SDK copying, fractional 0.3 to 0.1 plus 0.2 refunds, cancellation, keyboard focus, HTTP 500, unreachable local server, recovery and long text at 320px. A separate audit confirms 360px layouts, loading, HTTP 429, network errors, missing pages and print. The final manual was also walked with the keyboard in the in-app browser through sample loading and invoice submission.

The print check verifies a two-item receipt at 875px within A4's available 1002px height, with a 32mm QR image. See [DESIGN.md](DESIGN.md), [DESIGN-AUDIT.json](DESIGN-AUDIT.json), and the screenshots/ directory for visual evidence.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm build:packages
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm check:packages
node scripts/verify-packed.mjs
pnpm check:size
```

Use `CI=1 PLAYWRIGHT_PORT=3010 pnpm test:e2e` after building when an existing preview occupies port 3000. CI mode tests the production server; local mode can reuse a development server.

## Assumptions and remaining gaps

All nineteen local assumptions are listed in [ASSUMPTIONS.md](ASSUMPTIONS.md). The principal unresolved areas are GRA's precise rounding and refund-allocation rules, TIN syntax, SELECTIVE discount semantics, specialized-category tax bases, historical statutory recomputation, and missing cancellation/note/account response examples. Those gaps remain explicit in types, policy constants, validation scope and mock-only acknowledgements.

No live GRA transaction or certification was attempted. Signatures, receipt numbers and identity lookup records are mock values. Bun, Deno and individual edge-provider runtimes were not executed; their portability is based on the core's Web APIs and injected-fetch tests, with actual Node and browser runs recorded above.

The Dockerfile is supplied but was not built because a Docker daemon was unavailable. Vercel deployment and npm publication were not performed. Release remains disabled until maintainers configure package ownership, repository metadata, npm authentication and the protected release environment. Deployment settings and local font licenses are in [DEPLOYMENT.md](DEPLOYMENT.md).

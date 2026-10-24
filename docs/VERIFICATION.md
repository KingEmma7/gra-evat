# Verification and limits

The original audit below used a fresh copy, Node 22.23.4, pnpm 9.15.9 and the frozen lockfile on 23 October 2026. These are measured local results, not a claim of GRA certification.

On 24 October, the static-export and Zod 4.6.6 security changes passed a frozen install, production build, lint, types, 137 unit/property tests, and all three production browser cases. Updated core coverage is 390/395 statements (98.73%), 306/332 branches (92.16%), 80/80 functions and 361/361 lines (100%). The static preview regression passed; the core entry measures 43,754 bytes, or 10,866 bytes gzip, excluding external Zod. The registry audit reported zero advisories. Raw schema compatibility follows Zod 4, as described in [USAGE.md](USAGE.md). The independent runtime, tax-oracle, mutation, accessibility and performance evidence below retains its original provenance and was not all rerun for this dependency update.

| Check                                                  | Measured result                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Installation, lint, strict types and production builds | Passed; ESM, CommonJS, declarations and Next.js output                                                                                     |
| Unit and property tests                                | 112 tests in four files passed                                                                                                             |
| Core coverage                                          | Statements 328/331 (99.09%); branches 245/257 (95.33%); functions 70/70 and lines 305/305 (100%)                                           |
| Production browser flows                               | 3/3 passed for invoice, refund and error flows                                                                                             |
| Package consumers                                      | publint and Are the Types Wrong passed; packed ESM/CJS consumers passed on Node 20.20.2 and 22.23.4, including strict NodeNext compilation |
| Independent checks                                     | 31 public contract-example schema checks, 3,002 Decimal-oracle cases and five killed critical mutations                                    |
| Portable runtimes                                      | 12 checks each on Bun 1.4.4, Deno 2.9.6, Cloudflare workerd 2026-10-23 and the non-root Linux ARM64 Docker mock                            |
| Interface                                              | 34 second-pass axe scans with zero reported violations or document overflow at 320, 360, 768 and 1440px                                    |
| Keyboard and zoom                                      | All 50 empty-state and 124 populated-state controls reached; native 200% Chrome zoom passed five sections                                  |
| Mobile Lighthouse                                      | One localhost run: Performance 98, Accessibility 100, Best Practices 96, SEO 100                                                           |
| Core ESM entry                                         | 40,553 bytes, 10,008 bytes gzip, excluding external Zod                                                                                    |

Coverage measures `packages/core/src`, excluding tests and type-only files. It is not whole-repository coverage. The independent oracle verifies the documented local rounding policy. It does not establish an official GRA rounding rule. The Docker and portable runtime runs exercised mock invoice/refund calls, headers, retries, typed errors and AbortSignal timeouts.

The exact README installation and development walkthrough passed at ports 3000 and 8787, including the synthetic invoice and CommonJS example. Clipboard denial and QR encoding failure recovered in browser fault checks. The production notice file matched the generated attribution file. The later dependency and static-export changes are covered by the separate 24 October checks above.

## Reproduce the repository checks

```sh
pnpm install --frozen-lockfile
pnpm build:packages
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm check:packages
node scripts/verify-packed.mjs
pnpm check:size
```

The coverage command runs the unit suite. Browser tests require Chromium. Check the relevant [CI workflow](../.github/workflows/ci.yml) for the maintained automation. Independent runtime/oracle checks above describe the recorded audit and are not all part of that workflow.

## Limits to retain

- [ASSUMPTIONS.md](ASSUMPTIONS.md) records rounding, refund allocation, TIN syntax, SELECTIVE discounts, specialized bases, historical recomputation and undocumented responses. Public examples and the mock do not prove live GRA acceptance.
- No live GRA transaction or certification was attempted. The implementation guide contains a one-pesewa component-sum discrepancy, discussed in [TAX-RULES.md](TAX-RULES.md).
- Native spoken screen readers, physical phones, other operating systems, other architectures and every edge platform were not individually tested. Automated accessibility checks do not establish universal conformance.
- The Lighthouse result is one simulated-mobile localhost run, not a low-end-device benchmark. A separate 30-case, 1,000-line calculation/validation probe measured median 32.04ms and maximum 68.47ms; it did not render 1,000 builder rows.
- Real credentials belong on the integrator's server. Review [SECURITY.md](../SECURITY.md), [API.md](API.md) and [DEPLOYMENT.md](DEPLOYMENT.md) before integration or hosting. npm release and package-name ownership are separate from source publication.

Older screenshots and design records retain their original provenance. The detailed local audit records are archived separately and are not required to use or contribute to the repository.

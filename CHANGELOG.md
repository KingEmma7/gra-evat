# Changelog

## Unreleased

- Update Zod to 4.6.6 to fix GHSA-mrhx-c7xc-m3w5 and reject oversized constrained arrays before processing their elements. Exported raw schemas now use Zod 4. Compatibility regressions preserve the SDK `ValidationIssue` shape and captured messages, strict request fields, and extensible responses; this is not complete Zod 3 API compatibility. JavaScript `Infinity` is still rejected but its numeric-union diagnostic text can differ. See the [migration guide](https://zod.dev/v4/changelog).
- Export the playground for Cloudflare Workers Static Assets, preserving response security headers and a loopback-only local preview. The hosted demo runs its mock in the browser.

- Generate third-party copyright and licence notices with each browser build.

- Validate calculation mode and tax configuration even for an empty invoice.
- Reject zero exchange rates consistently in invoice items, notes and statements of account.
- Pin CI and release actions to verified commits and bound verification job time.
- Update vulnerable transitive PostCSS and esbuild dependencies.
- Add playground CSP and response security headers.

## 0.1.0

Initial source release: typed E-VAT v8.2 SDK, integer 2026 tax calculator, validation, Hono simulator, CLI, and browser playground. Future package versions and changelog entries are managed through Changesets.

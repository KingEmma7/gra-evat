# Contributing

Install Node 20.19+ and pnpm 9.15.9. Run `pnpm install`, `pnpm build:packages`, and `pnpm dev`.

Before a pull request, run `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, `pnpm test:e2e`, and `pnpm check:packages`. Install Chromium with `pnpm exec playwright install chromium` for browser tests.

Every API change must link to the v8.2 Postman contract or official GRA documentation. Preserve exact field casing, endpoint spelling and response structure. Add an explicit assumption when evidence is incomplete. Add tests for changed arithmetic, validation, retry or refund behavior. Keep money in integer pesewas and use the shared browser/server mock logic.

Use synthetic identities and the literal `mock` key in fixtures. Never include live credentials, real invoices or personal taxpayer data. Report security problems as described in SECURITY.md.

Add a Changeset with `pnpm changeset` for public package changes. Keep public TSDoc examples runnable. Submit a focused pull request describing the behavior, contract evidence, validation and remaining gaps.

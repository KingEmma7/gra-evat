# Contributing to gra-evat

Start with a [good first issue](https://github.com/KingEmma7/gra-evat/labels/good%20first%20issue), improve an example, or report a reproducible problem. Comment on an issue with your proposed scope so others can avoid duplicate work. You can open a small documentation pull request directly.

## Local setup

Use Node 20.19+ and pnpm 9.15.9, as declared in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The playground opens at http://localhost:3000 and the mock at http://localhost:8787. Stop these processes before browser tests if their ports conflict. The [README](README.md#ten-minute-quickstart) includes a sample invoice walkthrough.

## Make a focused change

Use synthetic identities and the literal `mock` key in examples and fixtures. Never submit live credentials, real invoices or personal taxpayer data. Report security issues through [private reporting](SECURITY.md).

API changes need evidence from the [v8.2 contract](docs/API.md) or an official GRA source. Preserve exact field casing, endpoint spelling and response structure. Document uncertain choices in [ASSUMPTIONS.md](docs/ASSUMPTIONS.md). Add a regression for changed arithmetic, validation, retry or refund behavior. Keep money in integer pesewas and reuse the shared browser/server mock logic.

## Check your change

For prose-only changes, check links and run Prettier on the files you edited. For a code change, run the affected tests first, then the project checks:

```sh
pnpm build:packages
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm check:packages
```

`test:coverage` already runs the unit suite, so there is no need to run `pnpm test` immediately before it. Package declarations must be built before typechecking a fresh installation. See [VERIFICATION.md](docs/VERIFICATION.md) for coverage scope and runtime limits.

Add a Changeset with `pnpm changeset` for public package changes. Keep TSDoc examples runnable. A pull request should explain the problem, the resulting behavior, contract evidence when relevant, checks actually run and any remaining gaps. Include a synthetic screenshot for a visual change. Follow the [code of conduct](CODE_OF_CONDUCT.md).

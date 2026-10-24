# Deployment

The public playground is [gra-evat.etagbor.workers.dev](https://gra-evat.etagbor.workers.dev/). The npm packages remain unpublished.

## Cloudflare Workers Static Assets

Use Node 22 and pnpm 9.15.9. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dlx wrangler@4.148.0 deploy
```

The deploy command requires an authorized Cloudflare login. `wrangler.jsonc` publishes `apps/playground/out/` at a dedicated origin. The export contains HTML, JavaScript, local fonts and licence notices. No Worker script, deployed API or application secrets are required. Security headers are generated into `out/_headers` from the same policy used by local development.

The hosted default is the in-browser mock. Its Hono routes and in-memory rules are the same implementation used by the Node server. Requests stay in the browser, and browser state disappears on refresh. All signatures and receipts are fake.

`NEXT_PUBLIC_GRA_BASE_URL` controls the separate server mode and defaults to `http://localhost:8787`. This is a local development feature, not the public demo's backend. Keep real GRA credentials in your application's server environment. The public playground has no input for them.

After deployment, inspect the CSP and security headers, local font responses and 404 page. In the default browser mode, load a sample invoice, issue a receipt, refund it and cancel the refund. Confirm the network log contains no localhost or external API requests. Explicit local-server mode should still report an unavailable local server clearly.

For a local production preview after building:

```sh
pnpm --filter @gra-evat/playground start --port 3000
```

This loopback-only preview serves the static export and its security headers. Development still uses `pnpm dev` with the separate Hono mock.

## Other static hosts

Vercel can also serve the export: choose the repository root, install with `pnpm install --frozen-lockfile`, build with `pnpm build`, and publish `apps/playground/out`. Configure the generated security policy using that host's header settings; `_headers` is consumed directly by Cloudflare. Do not use `next start` for the static export.

## Mock container

From the repository root:

```sh
docker build -f packages/mock/Dockerfile -t gra-evat-mock .
docker run --rm -p 127.0.0.1:8787:8787 -e MOCK_SEED=demo gra-evat-mock
```

The image runs as a non-root user and uses the production mock dependencies. The container's port is bound to the host loopback address in this example. All signatures are fake and all stored invoices disappear when the process exits.

## npm release

Before enabling `.github/workflows/release.yml`, set the actual repository metadata, verify ownership of the three package names, configure npm authentication, and protect the `npm` environment. Set the repository variable `ENABLE_NPM_RELEASE=true` only when those steps are complete. The workflow uses Changesets and requests npm provenance through GitHub OIDC permissions.

Use `pnpm changeset` for a release note. CI verifies both module formats and declarations with publint and Are the Types Wrong. `node scripts/verify-packed.mjs` installs the local core archive in a temporary application and runs the ESM invoice and CommonJS calculator examples.

## Font notices

The playground bundles IBM Plex Sans and IBM Plex Mono locally. Their SIL Open Font License and copyright notices are retained in [licenses/IBM-PLEX-SANS.txt](licenses/IBM-PLEX-SANS.txt) and [licenses/IBM-PLEX-MONO.txt](licenses/IBM-PLEX-MONO.txt). The project's MIT license does not replace those font licenses.

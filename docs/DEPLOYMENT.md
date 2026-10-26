# Deployment

The public playground is [gra-evat.etagbor.workers.dev](https://gra-evat.etagbor.workers.dev/). The npm packages remain unpublished.

## Automatic deployment after merge

Maintainers review and merge pull requests into protected `main`. After the exact merged commit passes every required CI verification job, the separate deployment job publishes that run's static artifact. gra-evat uses the Node 22 artifact after both supported Node versions pass. No application build or dependency lifecycle script runs with Cloudflare credentials.

The `production` GitHub environment permits only the `main` branch. Its `CLOUDFLARE_API_TOKEN` secret has Editor access to this existing Worker; `CLOUDFLARE_ACCOUNT_ID` is an environment variable. Pull-request verification has no access to that environment or token. Main protection applies to administrators; the solo maintainer can merge their own reviewed PR, so this does not promise an independent second approver.

Before publishing, the job verifies the artifact's commit, run identity and file hashes, then checks that the commit is still current `main` and belongs to a merged PR. Deployments run one at a time. Older successful runs are skipped if main has advanced. The deployment is not cancelled midway by a newer CI run. A main change during the final publish can briefly leave the preceding verified revision live until the newer revision passes and deploys.

The public `/__deployment.json` marker identifies the deployed commit and CI run. After publishing, CI checks that marker, the generated home-page security headers and a real 404 response. A failed live check marks the deployment job unsuccessful; it does not silently roll back or claim the previous site is still active. The artifact is retained for seven days. To retry a failed deployment, choose **Re-run all jobs** for the eligible main commit. **Re-run failed jobs** alone cannot reuse an artifact from an earlier run attempt. Expired artifacts also require a complete rerun.

## Rollback

For a routine rollback, merge a revert PR and let its successful CI publish normally. For an emergency manual rollback, pause this repository's CI workflow in GitHub Actions and wait for all active deployment jobs to finish. An authorized maintainer can inspect `wrangler deployments list` and run `pnpm dlx wrangler@4.148.0 rollback <VERSION_ID>` from this repository, or select the verified version in the Cloudflare dashboard. Only the 100 most recent published versions are eligible. Record the chosen version and check the live marker, security headers and routes. Re-enable CI and merge the corrective PR when ready; the next successful main deployment replaces the rollback.

See [Cloudflare's rollback guide](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) and [Worker token scopes](https://developers.cloudflare.com/workers/authorization/workers/). Hosting credentials belong in the protected environment, never in source files, browser variables or build output.

## Cloudflare Workers Static Assets

Use Node 22 and pnpm 9.15.9. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dlx wrangler@4.148.0 deploy
```

The manual deploy command requires an authorized Cloudflare login. Pause automatic deployments and wait for any active deployment to finish before using it. `wrangler.jsonc` publishes `apps/playground/out/` at a dedicated origin. The export contains HTML, JavaScript, local fonts and licence notices. No Worker script, deployed API or application secrets are required. Security headers are generated into `out/_headers` from the same policy used by local development.

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

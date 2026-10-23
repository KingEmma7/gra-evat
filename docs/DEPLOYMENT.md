# Deployment

The source is prepared for deployment. No site or npm package has been published.

## Vercel playground

Connect your own repository and select `apps/playground` as the project root. Enable access to files outside that root so the workspace packages can be built.

Use these project settings:

| Setting         | Value                                           |
| --------------- | ----------------------------------------------- |
| Framework       | Next.js                                         |
| Node            | 22                                              |
| Install command | `cd ../.. && pnpm install --frozen-lockfile`    |
| Build command   | `cd ../.. && pnpm build`                        |
| Output          | Next.js default `.next` under `apps/playground` |

The hosted default is the in-browser mock. Its Hono routes and in-memory rules are the same implementation used by the Node server. It needs no credentials or deployed API. Browser state disappears on refresh.

`NEXT_PUBLIC_GRA_BASE_URL` is optional and controls the separate server mode. Its local default is `http://localhost:8787`. Keep real GRA credentials in your application's server environment. The public playground has no input for them.

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

# Third-party notices

The project source uses the MIT licence. Dependencies and fonts retain their own licences.

The development and production build commands run `scripts/third-party-notices.mjs`. It reads the installed production dependency graph, preserves copyright and licence text, includes Next.js vendored components and writes `/THIRD_PARTY_NOTICES.txt` into the browser's public files. The generated file is intentionally excluded from Git and included in the built site. Keep it with the delivered browser assets. Generation fails when a package needs a notice that has not been reviewed.

The notice file deliberately includes installed build and server JavaScript dependencies as well as browser code. It does not assert that every listed package is bundled into the app. Native optional SWC, sharp/libvips and Node canvas binaries are installed tools and are not copied into the browser output. No dependency source is modified except the separately documented MoMo archive patch where applicable. Fonts remain unmodified.

## Distribution review, 23 October 2026

- MIT, ISC, BSD and 0BSD notices are retained with their copyright statements.
- Apache-2.0 licence text and packaged NOTICE files are retained. PDF.js's original worker header is preserved when it is copied.
- OFL font notices accompany the unmodified fonts. No reserved font name is used for a modified font.
- CC-BY-4.0 data and MPL-2.0 tools occur in the installed build graph. Their notices are retained conservatively. Their native binaries and source are not embedded in the browser application.
- LGPL libvips is an optional native image-processing dependency of the framework. The static browser output and the gra-evat npm packages contain no libvips binary. A future standalone server/container distribution containing native dependencies requires its own binary/source distribution review; the current source checkout installs these packages from their upstream archives.

Review new dependencies and regenerate notices when updating the lockfile. Do not remove notices from the delivered assets. Repository publication does not publish `node_modules`, native dependencies, browser testing downloads or local audit data.

## npm packages

The core, mock and CLI builds keep their declared package dependencies external. Their package allowlists include the project LICENSE and README alongside the generated code and declarations. Zod, Hono and the Node adapter are installed as separate dependencies with their own licence files. The bundled playground receives the complete browser notices independently. Existing IBM Plex font licence files are retained in `docs/licenses/` and in the generated notice file.

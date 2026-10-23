# ADR 0002: Keep Node 20 compatibility while pinning dependencies

Status: accepted. Date: 2026-10-23.

The requested runtime includes Node 20 and pnpm 9. Registry metadata at build time shows that tsup 9, Vitest 5, concurrently 10 and Changesets 3 require Node 22; Changesets 3 additionally requires pnpm 10. We therefore use the latest stable compatible major versions: tsup 8, Vitest 4, concurrently 9 and Changesets 2. Exact versions and transitive dependencies are pinned in pnpm-lock.yaml.

TypeScript 5, Zod 3, Hono 4, Next.js 15, React 19, Tailwind 4, and pnpm 9 follow the requested major versions. Other direct dependencies use their current compatible stable versions. Node 20.19+ is required by the toolchain. GitHub Actions exercises Node 20 and 22; local verification records the actual available runtime separately.

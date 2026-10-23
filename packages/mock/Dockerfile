# Build from the repository root: docker build -f packages/mock/Dockerfile -t gra-evat-mock .
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/mock ./packages/mock
RUN pnpm install --frozen-lockfile --filter @gra-evat/mock...
RUN pnpm --filter @gra-evat/core build && pnpm --filter @gra-evat/mock build
RUN pnpm --filter @gra-evat/mock deploy --prod /deploy

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY --from=build --chown=node:node /deploy ./
USER node
EXPOSE 8787
CMD ["node", "dist/server.js"]

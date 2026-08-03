# CubeScape game server — Colyseus on Fly.io
FROM node:20-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# manifests first for layer caching (all workspace manifests must exist
# so pnpm can resolve the workspace graph)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/botclient/package.json packages/botclient/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @cubescape/server...

COPY packages/shared packages/shared
COPY packages/server packages/server

ENV NODE_ENV=production
EXPOSE 2567

CMD ["pnpm", "--filter", "@cubescape/server", "start"]

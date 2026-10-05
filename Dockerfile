# syntax=docker/dockerfile:1

# Mesma versão do .nvmrc. Debian (glibc) em vez de Alpine: o argon2 é módulo nativo e a CLI do
# Prisma baixa o schema engine conforme a libc e o OpenSSL detectados na instalação.
ARG NODE_VERSION=24.19.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# O prisma.config.ts lê DATABASE_URL com env(), que aborta quando a variável falta — inclusive no
# `prisma generate` do postinstall, que não conecta em banco nenhum. Valor fictício, só do build:
# ARG não chega à imagem final, e o serviço `migrate` recebe a URL real pelo compose.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

# Esta etapa também é a imagem do serviço `migrate`: `prisma migrate deploy` e o seed dependem de
# pacotes que são devDependencies (prisma, dotenv).
FROM build AS prod-deps
RUN npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/src/main"]

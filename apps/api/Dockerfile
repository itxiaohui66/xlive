FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api

FROM base AS dev
CMD ["npm", "run", "dev", "-w", "@xlive/api"]

FROM base AS build
RUN npm run build -w @xlive/api

FROM node:22-alpine AS production
WORKDIR /app
RUN apk add --no-cache openssl wget ffmpeg su-exec && addgroup -S app && adduser -S app -G app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=@xlive/api --include-workspace-root=false
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
RUN mkdir -p /app/uploads /app/live && chown -R app:app /app
# 回放目录由 SRS（root）写入，启动时放开目录写权限，再以 app 用户运行服务
CMD ["sh", "-c", "mkdir -p /app/live/replays && chmod -R a+rwX /app/live/replays 2>/dev/null || true; exec su-exec app sh -c 'npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/seed.js && node apps/api/dist/server.js'"]

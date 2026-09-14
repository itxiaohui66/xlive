FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
FROM base AS dev
CMD ["npm", "run", "dev", "-w", "@xlive/web", "--", "--host", "0.0.0.0"]
FROM base AS build
RUN npm run build -w @xlive/web
FROM nginx:1.27-alpine AS production
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

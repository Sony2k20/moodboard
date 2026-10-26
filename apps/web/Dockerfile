# syntax=docker/dockerfile:1
#
# The web image: nginx serving the static Angular bundle. No Node at runtime — the frontend is a
# bundle, and the API is a separate service.

FROM node:24-slim AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx nx build web --configuration=production

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
# The unprivileged image runs as UID 101 and listens on 8080, so no capability to bind a
# privileged port is needed. The chart's service targets 8080 accordingly.
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/apps/web/browser/ /usr/share/nginx/html/
EXPOSE 8080

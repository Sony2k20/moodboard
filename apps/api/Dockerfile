# syntax=docker/dockerfile:1
#
# The api image. It carries two entry points: `main.js` (the server) and `migrate.js`, which the
# ArgoCD PreSync job runs (§4.11). Both come from the same build, so the schema and the code that
# expects it cannot come from different commits.

FROM node:24-slim AS build
WORKDIR /src

# Dependencies first, so a source change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `prune` writes a package.json and lockfile containing only what the bundle actually needs.
RUN npx nx build api --configuration=production && npx nx prune api

FROM node:24-slim AS runtime
# Chart default. The HostPath on the node must be owned by this UID — `fsGroup` has no effect on
# hostPath volumes, so a mismatch produces a pod that starts cleanly and fails on first write
# (§4.2). Overridable via the chart, but the image default has to match it.
ARG UID=1000
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /src/dist/apps/api/package.json /src/dist/apps/api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /src/dist/apps/api/ ./

USER $UID
EXPOSE 3000
CMD ["node", "main.js"]

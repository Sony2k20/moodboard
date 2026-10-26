# syntax=docker/dockerfile:1
#
# The worker image: the BullMQ consumer that produces thumbnails, captures and classifications.
#
# Playwright and ffmpeg are deliberately absent for now. They belong to the capture step, and the
# Playwright base image is large enough that carrying it before anything uses it would slow every
# build for nothing. When it arrives, the runtime stage changes base image — the rest of this
# file does not.

FROM node:24-slim AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx nx build worker --configuration=production && npx nx prune worker

FROM node:24-slim AS runtime
# Must match the owner of the HostPath directory; see apps/api/Dockerfile and §4.2. The worker is
# the process that writes there, so a wrong UID shows up here first.
ARG UID=1000
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /src/dist/apps/worker/package.json /src/dist/apps/worker/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /src/dist/apps/worker/ ./

USER $UID
CMD ["node", "main.js"]

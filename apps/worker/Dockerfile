# syntax=docker/dockerfile:1
#
# The worker image: the BullMQ consumer that produces thumbnails, captures and classifications.
#
# Chromium comes from `playwright install` on node:24-slim rather than from the Playwright base
# image: that one pins its own Node version, and this one has to match the build stage (0011).
# The full Chromium, not the headless shell — bot detection spots the shell more easily. ffmpeg
# arrives with the scroll video, not before.

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

# Outside the home directory, which UID 1000 does not have here, and readable by it. The version
# is the one in package-lock.json, so the browser always matches the library driving it.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright

COPY --from=build /src/dist/apps/worker/ ./

USER $UID
CMD ["node", "main.js"]

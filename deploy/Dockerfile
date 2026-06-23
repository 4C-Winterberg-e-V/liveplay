# syntax=docker/dockerfile:1
# =====================================================================
# LivePlay web client — static SPA served by nginx (Mode B, and the SPA
# image behind a Traefik proxy in Mode A).
#
# Build context: the REPOSITORY ROOT (so we can copy both client/ and
# deploy/nginx.conf). Example:
#   docker build -f deploy/Dockerfile -t liveplay-web .
# =====================================================================

# ---- Build stage: generate the static SPA ---------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install deps first for layer caching. (npm install, not ci: the lockfile
# is not guaranteed to be in lockstep across forks.)
COPY client/package.json client/package-lock.json ./
RUN npm install --no-audit --no-fund

COPY client/ .

# Hosting base path. '/' for root hosting; override for a sub-path, e.g.
#   --build-arg NUXT_APP_BASE_URL=/liveplay/
ARG NUXT_APP_BASE_URL=/
ENV NUXT_APP_BASE_URL=${NUXT_APP_BASE_URL}
RUN npm run generate:web

# ---- Runtime stage: nginx serving the static files ------------------
FROM nginx:alpine AS runtime
COPY --from=build /app/.output/public /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

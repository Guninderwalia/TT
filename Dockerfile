# TaskTango server-mode container.
#
# Builds the React frontend, installs prod deps (incl. native sqlite3),
# and starts src/server/server.js. The frontend is served as static files
# by webServer.js's express.static() pointing at the build/ directory.
#
# Required env at runtime:
#   USER_DATA_PATH  — absolute path to a persistent volume (default /data)
#   PORT            — HTTP listen port (default 8080)
#
# Optional env:
#   OFFICE_TIMEZONE — IANA zone shown to users (default reads from settings table)

FROM node:20-bookworm-slim AS base

# sqlite3 + bcryptjs ship native bindings that need build tools to compile.
# We install them in a single layer and clean up apt cache so the image
# stays small.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Dependencies first so the layer caches when only source changes ----
COPY package*.json ./
# `npm install` over `ci` because lockfile may be out of sync with the
# repo at deploy time. Switch to ci once the lockfile is in source control.
RUN npm install --omit=dev --no-audit --no-fund

# ---- Source ----
COPY . .

# ---- Build the React frontend ----
RUN npm run server-build

# ---- Runtime config ----
ENV NODE_ENV=production
ENV USER_DATA_PATH=/data
ENV PORT=8080

# Fly.io / Render / Railway will route HTTPS to this port internally.
EXPOSE 8080

# The persistent volume is mounted at /data by the platform's volume config.
# We don't VOLUME-declare it here so a Docker `run` without -v still boots
# (writes go to the writable layer instead — fine for local smoke tests).

CMD ["node", "src/server/server.js"]

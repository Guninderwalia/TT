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

# trixie (Debian 13) has GLIBC 2.41, satisfying sqlite3's prebuilt binary
# requirement of GLIBC >= 2.38. bookworm-slim (Debian 12 / GLIBC 2.36) tripped
# "libm.so.6: version `GLIBC_2.38' not found" at startup. Forcing all native
# modules to build from source instead would've worked, but lzma-native (a
# transitive dev dep of electron-builder) doesn't compile cleanly — so the
# newer base is the cleanest fix.
FROM node:20-trixie-slim AS base

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
# Install EVERYTHING (incl. devDependencies) — react-scripts is a dev dep and
# we need it for the React build below. The trixie GLIBC (2.41) is new enough
# for sqlite3's prebuilt binary so no source-build flag needed. We prune dev
# deps right after the React build.
RUN npm install --no-audit --no-fund

# ---- Source ----
COPY . .

# ---- Build the React frontend ----
RUN npm run server-build

# ---- Strip devDependencies now that the build is done ----
# Saves ~150 MB in the final image (react-scripts + electron-builder + co.)
RUN npm prune --omit=dev --no-audit --no-fund

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

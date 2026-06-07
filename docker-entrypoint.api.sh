#!/bin/sh
# ─────────────────────────────────────────────────────────
# API startup: run Prisma migrations, then start the server.
# ─────────────────────────────────────────────────────────
set -e

if [ -n "$DATABASE_URL" ] && [ -f "./prisma/schema.prisma" ]; then
  echo "[api] Running database migrations…"
  prisma migrate deploy --schema=./prisma/schema.prisma
fi

exec "$@"

#!/bin/sh
# ─────────────────────────────────────────────────────────
# Next.js runtime env injection for NEXT_PUBLIC_* vars.
# Replaces build-time placeholders with runtime values.
# ─────────────────────────────────────────────────────────
set -e

APP_DIR="${APP_DIR:-/app/apps/web}"

if [ -n "$NEXT_PUBLIC_API_URL" ]; then
  find "$APP_DIR" -type f \( -name "*.js" -o -name "*.mjs" \) \
    -exec sed -i "s|__NEXT_PUBLIC_API_URL_PLACEHOLDER__|$NEXT_PUBLIC_API_URL|g" {} +
fi

exec "$@"

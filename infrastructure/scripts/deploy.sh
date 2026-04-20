#!/usr/bin/env bash
set -euo pipefail

# ─── DEVteam Deploy Script ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

info()  { echo "[INFO]  $*"; }
error() { echo "[ERROR] $*" >&2; exit 1; }

# ── Validate environment ──────────────────────────────────────────────────────
info "Validating environment..."
[[ -z "${OPENAI_API_KEY:-}" ]]  && error "OPENAI_API_KEY is not set"
[[ -z "${JWT_SECRET:-}" ]]      && error "JWT_SECRET is not set"
[[ -z "${API_KEY_SALT:-}" ]]    && error "API_KEY_SALT is not set"

# ── Build ─────────────────────────────────────────────────────────────────────
info "Building images..."
cd "$ROOT_DIR"
docker compose build --no-cache

# ── Deploy ────────────────────────────────────────────────────────────────────
info "Starting services..."
docker compose up -d

# ── Health check ──────────────────────────────────────────────────────────────
info "Waiting for backend health..."
for i in {1..30}; do
  if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    info "Backend healthy"
    break
  fi
  [[ $i -eq 30 ]] && error "Backend did not become healthy in time"
  sleep 2
done

info "Deploy complete — frontend: http://localhost:3000"

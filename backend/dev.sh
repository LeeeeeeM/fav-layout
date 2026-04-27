#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
BIN_DIR="$SCRIPT_DIR/bin"
AIR_BIN="$BIN_DIR/air"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "[dev.sh] .env not found, created from .env.example"
  else
    echo "[dev.sh] ERROR: .env and .env.example are both missing"
    exit 1
  fi
fi

if [[ ! -x "$AIR_BIN" ]]; then
  echo "[dev.sh] local air not found, installing to $AIR_BIN ..."
  mkdir -p "$BIN_DIR"
  GOBIN="$BIN_DIR" go install github.com/air-verse/air@latest
fi

echo "[dev.sh] starting backend with local air..."
exec "$AIR_BIN"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/bin"

mkdir -p "$BIN_DIR"
echo "[install-air.sh] installing air to $BIN_DIR/air"
GOBIN="$BIN_DIR" go install github.com/air-verse/air@latest
"$BIN_DIR/air" -v

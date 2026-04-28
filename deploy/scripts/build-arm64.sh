#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-fav-layout}"
IMAGE_TAG="${IMAGE_TAG:-arm64-latest}"
PLATFORM="linux/arm64"
PUSH_MODE="${1:-}"

cd "$ROOT_DIR"

docker buildx create --use --name fav-layout-builder >/dev/null 2>&1 || true
docker buildx inspect --bootstrap >/dev/null

if [[ "$PUSH_MODE" == "--push" ]]; then
  echo "Building and pushing ${IMAGE_NAME}:${IMAGE_TAG} for ${PLATFORM}"
  docker buildx build \
    --platform "$PLATFORM" \
    -t "${IMAGE_NAME}:${IMAGE_TAG}" \
    --push \
    .
else
  echo "Building and loading ${IMAGE_NAME}:${IMAGE_TAG} for ${PLATFORM}"
  docker buildx build \
    --platform "$PLATFORM" \
    -t "${IMAGE_NAME}:${IMAGE_TAG}" \
    --load \
    .
fi

echo "Done: ${IMAGE_NAME}:${IMAGE_TAG}"

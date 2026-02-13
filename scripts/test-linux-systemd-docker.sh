#!/usr/bin/env bash

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but not installed." >&2
  exit 1
fi

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

docker run --rm \
  --volume "${REPO_ROOT}:/workspace" \
  --workdir /workspace \
  oven/bun:1 \
  bash scripts/test-linux-systemd-smoke.sh

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_name="compass-linux-builder"

docker build --platform linux/amd64 \
  --file "$repo_root/docker/linux-build.Dockerfile" \
  --tag "$image_name" \
  "$repo_root"
docker run --rm --platform linux/amd64 \
  --volume "$repo_root:/workspace" \
  --workdir /workspace \
  "$image_name" \
  bash -lc 'npm ci && npm run make -- --platform linux --arch x64 --targets deb,rpm,@electron-forge/maker-zip'

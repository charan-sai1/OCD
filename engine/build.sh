#!/usr/bin/env bash
# Builds OCD Manager for every supported platform into ./dist
set -euo pipefail
cd "$(dirname "$0")"

out="dist"
mkdir -p "$out"

# The version the running app reports and compares against releases.
version="${VERSION:-dev}"

# Pure-Go, no cgo -> single static binaries, no toolchain needed on the target.
export CGO_ENABLED=0

build() {
  local os="$1" arch="$2" ext="$3"
  local name="ocd-${os}-${arch}${ext}"
  echo "building $name ($version)"
  GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags "-s -w -X main.version=$version" -o "$out/$name" .
}

build windows amd64 .exe
build windows arm64 .exe
build linux   amd64 ""
build linux   arm64 ""
build darwin  amd64 ""
build darwin  arm64 ""

echo
echo "Done. Binaries in $out:"
ls -lh "$out"

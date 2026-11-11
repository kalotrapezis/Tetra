#!/usr/bin/env bash
# What a Windows build needs that npm on Linux never installs: sharp's Windows binary (npm only fetches this computer's).
# onnxruntime-node already carries its win32 build. Downloads are kept in desktop/build-tools/win between builds.
# Usage: scripts/win-deps.sh   (from desktop/; run by `npm run dist:win`)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
V=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/sharp/package.json')).version")
OUT=node_modules/@img/sharp-win32-x64
[ "$(node -p "try { require('./$OUT/package.json').version } catch { '' }")" = "$V" ] && exit 0
mkdir -p build-tools/win
[ -f "build-tools/win/img-sharp-win32-x64-$V.tgz" ] || (cd build-tools/win && npm pack -q "@img/sharp-win32-x64@$V")
rm -rf "$OUT" && mkdir -p "$OUT" && tar xzf "build-tools/win/img-sharp-win32-x64-$V.tgz" -C "$OUT" --strip-components=1
echo "sharp-win32-x64 $V"

#!/usr/bin/env bash
# What the map builder runs, carried inside the Windows installer, as scripts/bundle-tools.sh does for the AppImage: a Java 17
# runtime for GraphHopper and a Python with osmium. Both are made here on Linux: jlink builds a Windows runtime from the Windows
# JDK's jmods (same version as the Linux JDK that runs it), and osmium's Windows wheels are unpacked into the Windows Python.
# Makes desktop/bundled-win/{jre,python}; downloads are kept in desktop/build-tools/win between builds.
# Usage: scripts/bundle-tools-win.sh   (from desktop/; run by `npm run dist:win`)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
CACHE=build-tools/win OUT=bundled-win
LINUX_JDK_URL=https://api.adoptium.net/v3/binary/version/jdk-17.0.16%2B8/linux/x64/jdk/hotspot/normal/eclipse
WIN_JDK_URL=https://api.adoptium.net/v3/binary/version/jdk-17.0.16%2B8/windows/x64/jdk/hotspot/normal/eclipse
PY_URL=https://github.com/astral-sh/python-build-standalone/releases/download/20250918/cpython-3.12.11+20250918-x86_64-pc-windows-msvc-install_only_stripped.tar.gz
# the same modules as scripts/bundle-tools.sh
MODULES=java.base,java.compiler,java.desktop,java.instrument,java.naming,java.scripting,java.security.jgss,java.sql,jdk.attach,jdk.jdi,jdk.management,jdk.unsupported,java.logging,java.xml,jdk.crypto.ec,jdk.zipfs
fetch() { [ -f "$2" ] || { curl -fL -o "$2.part" "$1" && mv "$2.part" "$2"; }; }
mkdir -p "$CACHE" "$OUT"

if [ ! -f "$OUT/jre/bin/java.exe" ]; then
  if [ ! -x build-tools/jdk/bin/jlink ]; then # the Linux JDK, shared with scripts/bundle-tools.sh
    fetch "$LINUX_JDK_URL" build-tools/jdk.tar.gz
    rm -rf build-tools/jdk && mkdir -p build-tools/jdk && tar xzf build-tools/jdk.tar.gz -C build-tools/jdk --strip-components=1
  fi
  fetch "$WIN_JDK_URL" "$CACHE/jdk.zip"
  rm -rf "$CACHE/jdk" && mkdir -p "$CACHE/jdk" && unzip -q "$CACHE/jdk.zip" -d "$CACHE/jdk"
  rm -rf "$OUT/jre"
  build-tools/jdk/bin/jlink --module-path "$(echo "$CACHE"/jdk/*/jmods)" --add-modules "$MODULES" --strip-debug --no-header-files \
    --no-man-pages --compress=2 --output "$OUT/jre"
fi

if [ ! -f "$OUT/python/python.exe" ]; then
  fetch "$PY_URL" "$CACHE/python.tar.gz"
  rm -rf "$OUT/python" && mkdir -p "$OUT/python" && tar xzf "$CACHE/python.tar.gz" -C "$OUT/python" --strip-components=1
  rm -rf "$CACHE/wheels" && python3 -m pip download -q --platform win_amd64 --python-version 3.12 --only-binary=:all: osmium -d "$CACHE/wheels"
  for w in "$CACHE"/wheels/*.whl; do unzip -qo "$w" -d "$OUT/python/Lib/site-packages"; done
  # what a build never runs: tests, Tk, IDLE, pip itself, headers, caches
  rm -rf "$OUT/python/Lib/test" "$OUT/python/Lib/idlelib" "$OUT/python/Lib/tkinter" "$OUT/python/Lib/turtledemo" \
    "$OUT/python/Lib/ensurepip" "$OUT/python/Lib/site-packages/pip" "$OUT/python/tcl" "$OUT/python/include"
  find "$OUT/python" -name '__pycache__' -prune -exec rm -rf {} +
fi

[ -f "$OUT/jre/bin/java.exe" ] && [ -f "$OUT/python/python.exe" ] && [ -d "$OUT/python/Lib/site-packages/osmium" ]
du -sh "$OUT/jre" "$OUT/python"

#!/bin/sh
# Build dist/index.html (stamped with the git version) and dist/webmetronome-<hash>.zip
set -eu
cd "$(dirname "$0")/.."

hash=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain)" ]; then hash="$hash-dirty"; fi
version="$hash $(date -u +%Y-%m-%dT%H:%M:%SZ)"
literal="const APP_VERSION = 'dev';"

n=$(grep -cF "$literal" src/index.html || true)
if [ "$n" != "1" ]; then
  echo "build: expected exactly one '$literal' in src/index.html, found $n" >&2
  exit 1
fi

mkdir -p dist
rm -f dist/webmetronome-*.zip
sed "s/$literal/const APP_VERSION = '$version';/" src/index.html > dist/index.html

if [ "$(grep -cF "const APP_VERSION = '$version';" dist/index.html)" != "1" ]; then
  echo "build: version stamp failed" >&2
  exit 1
fi

zipfile="webmetronome-$hash.zip"
if command -v zip >/dev/null 2>&1; then
  (cd dist && zip -q "$zipfile" index.html)
else
  powershell -NoProfile -Command "Compress-Archive -Force -Path 'dist/index.html' -DestinationPath 'dist/$zipfile'"
fi

echo "built dist/$zipfile"
grep -F "const APP_VERSION" dist/index.html

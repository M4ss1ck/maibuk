#!/usr/bin/env bash
# Builds the probe into public/probe so Vite copies it into dist (and the Tauri builds).
# DEPS: a node_modules with react@19.2.3, react-dom, @remote-dom/core, @remote-dom/react, @quilted/threads.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
deps=${PROBE_DEPS:?set PROBE_DEPS to the directory holding that node_modules}
out="$here/../../public/probe"
mkdir -p "$out"
esb="$here/../../node_modules/.bin/esbuild"
for f in host worker; do
  NODE_PATH="$deps/node_modules" "$esb" "$here/t3/$f.tsx" --bundle --format=iife --minify --jsx=automatic \
    --define:process.env.NODE_ENV='"production"' --target=es2020 --outfile="$out/t3-$f.js" \
    --resolve-extensions=.tsx,.ts,.js --alias:react="$deps/node_modules/react" --alias:react-dom="$deps/node_modules/react-dom"
done
cp "$here/probe/index.html" "$here/probe/probe.js" "$out/"
ls -la "$out"

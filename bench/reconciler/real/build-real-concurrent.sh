#!/bin/bash
# Assemble + bundle the concurrent-root real-react-reconciler baseline with
# the deterministic scheduler aliased over the `scheduler` package.
set -e
cd "$(dirname "$0")"

cat > entry-concurrent.cjs <<'EOF'
// Hermes CLI shims
if (typeof globalThis.setTimeout === 'undefined') {
  globalThis.setTimeout = function () { return 0; };
  globalThis.clearTimeout = function () {};
}
if (typeof globalThis.console === 'undefined') {
  globalThis.console = {log: print, warn: print, error: print};
}
globalThis.mkList = function () { return []; };
globalThis.anyNull = function () { return null; };
globalThis.mkObj = function () { return {}; };
globalThis.anyVal = function (x) { return x; };
globalThis.coerceInt = function (n) { return n | 0; };
var mkList = globalThis.mkList;
var anyNull = globalThis.anyNull;
var mkObj = globalThis.mkObj;
var anyVal = globalThis.anyVal;
var coerceInt = globalThis.coerceInt;

EOF
cat host-config.inc.js >> entry-concurrent.cjs
cat concurrent-app.inc.js >> entry-concurrent.cjs
cat main-real-concurrent-body.js >> entry-concurrent.cjs

npx esbuild entry-concurrent.cjs --bundle --platform=neutral --format=iife \
  --alias:scheduler=./det-scheduler.cjs \
  --define:process.env.NODE_ENV='"production"' \
  --define:__DEV__=false \
  --outfile=real-react-concurrent-bundle.js
echo "built real-react-concurrent-bundle.js ($(wc -c < real-react-concurrent-bundle.js) bytes)"

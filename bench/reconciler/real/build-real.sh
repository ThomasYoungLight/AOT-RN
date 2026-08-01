#!/bin/bash
# Assemble + bundle the real-react-reconciler baseline into one Hermes-runnable file.
set -e
cd "$(dirname "$0")"

cat > entry.cjs <<'EOF'
// Hermes CLI shims (scheduler feature-detects these; sync legacy mode never fires them)
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
EOF
cat >> entry.cjs <<'EOF'
var mkList = globalThis.mkList;
var anyNull = globalThis.anyNull;
var mkObj = globalThis.mkObj;
var anyVal = globalThis.anyVal;
var coerceInt = globalThis.coerceInt;

EOF
cat host-config.inc.js >> entry.cjs
cat feed-app.inc.js >> entry.cjs
cat main-real-body.js >> entry.cjs

npx esbuild entry.cjs --bundle --platform=neutral --format=iife \
  --define:process.env.NODE_ENV='"production"' \
  --define:__DEV__=false \
  --outfile=real-react-bundle.js
echo "built real-react-bundle.js ($(wc -c < real-react-bundle.js) bytes)"

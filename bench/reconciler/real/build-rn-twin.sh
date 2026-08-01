#!/bin/bash
# Build the ring-0 JS twin: real react-reconciler + shared benchmark as a
# single CommonJS Metro module, written into rn-tester.
set -e
cd "$(dirname "$0")"

cat > twin-entry.cjs <<'EOF'
'use strict';
// prelude (matches the typed unit's semantics)
function mkList() { return []; }
function mkObj() { return {}; }
function anyNull() { return null; }
function anyVal(x) { return x; }
function coerceInt(n) { return n | 0; }
EOF
cat host-config.inc.js >> twin-entry.cjs
cat feed-app.inc.js >> twin-entry.cjs
cat rn-core-js-body.js >> twin-entry.cjs

npx esbuild twin-entry.cjs --bundle --format=cjs --platform=neutral \
  --define:process.env.NODE_ENV='"production"' \
  --define:__DEV__=false \
  --outfile=../../../react-native/packages/rn-tester/js/hybrid/HybridReactCore.js
echo "built HybridReactCore.js ($(wc -c < ../../../react-native/packages/rn-tester/js/hybrid/HybridReactCore.js) bytes)"

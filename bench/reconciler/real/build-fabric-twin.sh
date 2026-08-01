#!/bin/bash
# Build the live-Fabric ring-0 JS twin: real react-reconciler (persistence
# mode) + shared fabric host/app as a single CommonJS Metro module, written
# into rn-tester.
set -e
cd "$(dirname "$0")"

cat > fabric-twin-entry.cjs <<'EOF'
'use strict';
// prelude (matches the typed unit's semantics)
var G = globalThis;
function mkList() { return []; }
function mkObj() { return {}; }
function anyNull() { return null; }
function anyVal(x) { return x; }
function coerceInt(n) { return n | 0; }
EOF
# real RN attribute-payload algorithm, minus its standalone benchmark driver
grep -v '^dpRunWorkload(' diffprops-real-body.js >> fabric-twin-entry.cjs
cat >> fabric-twin-entry.cjs <<'EOF'
function fhDiff(prevProps, nextProps, validAttributes) {
  return rnDiff(prevProps, nextProps, validAttributes);
}
function fhCreate(props, validAttributes) {
  return addNestedProperty(null, props, validAttributes);
}
EOF
cat fabric-host.inc.js >> fabric-twin-entry.cjs
cat fabric-app.inc.js >> fabric-twin-entry.cjs
cat fabric-core-js-body.js >> fabric-twin-entry.cjs

npx esbuild fabric-twin-entry.cjs --bundle --format=cjs --platform=neutral \
  --define:process.env.NODE_ENV='"production"' \
  --define:__DEV__=false \
  --outfile=../../../react-native/packages/rn-tester/js/hybrid/HybridFabricCore.js
echo "built HybridFabricCore.js ($(wc -c < ../../../react-native/packages/rn-tester/js/hybrid/HybridFabricCore.js) bytes)"

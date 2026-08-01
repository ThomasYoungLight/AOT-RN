#!/bin/bash
# Assemble the typed-port bundle: typed prelude + shared host config +
# reconciler port + shared app + harness, compiled with shermes -typed.
set -e
cd "$(dirname "$0")"

cat > typed-entry.ts <<'EOF'
'use strict';
const G: any = globalThis;
function mkList(): any {
  return new G.Array();
}
function anyNull(): any {
  return null;
}
function mkObj(): any {
  return new G.Object();
}
function anyVal(x: any): any {
  return x;
}
function coerceInt(n: number): number {
  return n | 0;
}
EOF
cat host-config.inc.js >> typed-entry.ts
cat typed-port-core.ts >> typed-entry.ts
cat feed-app.inc.js >> typed-entry.ts
cat typed-main.ts >> typed-entry.ts
echo "assembled typed-entry.ts ($(wc -l < typed-entry.ts) lines)"

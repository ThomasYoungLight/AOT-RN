#!/bin/bash
# Assemble the typed-port bundle: typed prelude + shared host config +
# reconciler port + shared app + harness, compiled with shermes -typed.
set -e
cd "$(dirname "$0")"

cat > typed-entry-concurrent.ts <<'EOF'
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
cat host-config.inc.js >> typed-entry-concurrent.ts
cat typed-port-core.ts >> typed-entry-concurrent.ts
cat concurrent-app.inc.js >> typed-entry-concurrent.ts
cat typed-main-concurrent.ts >> typed-entry-concurrent.ts
echo "assembled typed-entry-concurrent.ts ($(wc -l < typed-entry-concurrent.ts) lines)"

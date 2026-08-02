#!/bin/bash
# Assemble the typed-port bundle: typed prelude + shared host config +
# reconciler port + shared app + harness, compiled with shermes -typed.
set -e
cd "$(dirname "$0")"

cat > typed-entry-concurrent-persistent.ts <<'EOF'
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
cat host-config.inc.js >> typed-entry-concurrent-persistent.ts
cat typed-port-core.ts >> typed-entry-concurrent-persistent.ts
cat concurrent-app.inc.js >> typed-entry-concurrent-persistent.ts
cat typed-main-concurrent.ts >> typed-entry-concurrent-persistent.ts
echo "assembled typed-entry-concurrent-persistent.ts ($(wc -l < typed-entry-concurrent-persistent.ts) lines)"
python3 - <<'PYEOF'
s = open('typed-entry-concurrent-persistent.ts').read()
s = s.replace('const supportsMutation = true;', 'const supportsMutation = false;')
s = s.replace('const supportsPersistence = false;', 'const supportsPersistence = true;')
s = s.replace("'typed-port-reconciler-concurrent(18.3-port): '", "'typed-port-reconciler-concurrent-persistent(18.3-port): '")
open('typed-entry-concurrent-persistent.ts','w').write(s)
print('flipped to persistence mode')
PYEOF

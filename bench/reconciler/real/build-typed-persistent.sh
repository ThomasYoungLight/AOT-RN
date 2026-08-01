#!/bin/bash
# Assemble the typed-port bundle: typed prelude + shared host config +
# reconciler port + shared app + harness, compiled with shermes -typed.
set -e
cd "$(dirname "$0")"

cat > typed-entry-persistent.ts <<'EOF'
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
cat host-config.inc.js >> typed-entry-persistent.ts
cat typed-port-core.ts >> typed-entry-persistent.ts
cat feed-app.inc.js >> typed-entry-persistent.ts
cat typed-main.ts >> typed-entry-persistent.ts
echo "assembled typed-entry-persistent.ts ($(wc -l < typed-entry-persistent.ts) lines)"
python3 - <<'PYEOF'
s = open('typed-entry-persistent.ts').read()
s = s.replace('const supportsMutation = true;', 'const supportsMutation = false;')
s = s.replace('const supportsPersistence = false;', 'const supportsPersistence = true;')
s = s.replace("print('typed-port-reconciler(18.3-port): '", "print('typed-port-reconciler-persistent(18.3-port): '")
open('typed-entry-persistent.ts','w').write(s)
print('flipped to persistence mode')
PYEOF

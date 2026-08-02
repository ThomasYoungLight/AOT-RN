#!/bin/bash
# Concurrent persistence with the pass-children contract.
set -e
cd "$(dirname "$0")"
bash build-typed-concurrent-persistent.sh
python3 - <<'PYEOF'
s = open('typed-entry-concurrent-persistent.ts').read()
s = s.replace('const passChildrenWhenCloningPersistedNodes = false;',
              'const passChildrenWhenCloningPersistedNodes = true;')
s = s.replace("'typed-port-reconciler-concurrent-persistent(18.3-port): '",
              "'typed-port-reconciler-concurrent-persistent-passchildren(18.3-port): '")
open('typed-entry-concurrent-persistent-passchildren.ts', 'w').write(s)
print('assembled typed-entry-concurrent-persistent-passchildren.ts')
PYEOF

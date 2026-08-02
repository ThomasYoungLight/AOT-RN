#!/bin/bash
# Persistence mode with the passChildrenWhenCloningPersistedNodes contract.
set -e
cd "$(dirname "$0")"
bash build-typed-persistent.sh
python3 - <<'PYEOF'
s = open('typed-entry-persistent.ts').read()
s = s.replace('const passChildrenWhenCloningPersistedNodes = false;',
              'const passChildrenWhenCloningPersistedNodes = true;')
s = s.replace("'typed-port-reconciler-persistent(18.3-port): '",
              "'typed-port-reconciler-persistent-passchildren(18.3-port): '")
open('typed-entry-persistent-passchildren.ts', 'w').write(s)
print('assembled typed-entry-persistent-passchildren.ts')
PYEOF

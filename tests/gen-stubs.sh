#!/bin/bash
# Offline-only: generates stub icons for lucide-react so the harness can bundle without network.
cd "$(dirname "$0")/.."
ICONS=$(grep -rhzoP "import \{[^}]*\} from 'lucide-react'" src | tr '\0' '\n' | grep -oE "[A-Za-z0-9]+( as [A-Za-z0-9]+)?" | grep -vE "^(import|from|lucide|react)$" | sed -E 's/ as .*//' | sort -u)
{
echo "import React from 'react';"
echo "const mk = (n) => { const C = (p) => React.createElement('svg', { 'data-icon': n, className: p.className, width: 16, height: 16 }); C.displayName = n; return C; };"
for i in $ICONS; do echo "export const $i = mk('$i');"; done
} > node_modules/lucide-react/index.js

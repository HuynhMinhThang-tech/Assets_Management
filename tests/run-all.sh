#!/bin/bash
# Chạy toàn bộ test OFFLINE (không cần npm install): esbuild + Chromium + stub lucide-react/xlsx.
# Yêu cầu: node, tsx, playwright (+ chromium) cài global; NODE_PATH trỏ tới global node_modules.
set -e
cd "$(dirname "$0")/.."
G=${NODE_PATH:-$(npm root -g)}
export NODE_PATH=$G
mkdir -p node_modules/xlsx node_modules/lucide-react tests/dist
[ -f node_modules/xlsx/index.js ] || cp tests/stubs/xlsx.js node_modules/xlsx/index.js
echo '{"name":"xlsx","type":"module","main":"index.js"}' > node_modules/xlsx/package.json
echo '{"name":"lucide-react","type":"module","main":"index.js"}' > node_modules/lucide-react/package.json
for m in react react-dom; do [ -e node_modules/$m ] || ln -s $G/$m node_modules/$m; done
bash tests/gen-stubs.sh
ESB=$G/tsx/node_modules/esbuild/bin/esbuild
$ESB src/main.tsx --bundle --outfile=tests/dist/app.js --format=iife --jsx=automatic --platform=browser --loader:.css=empty --define:process.env.NODE_ENV=\"development\" --log-level=warning
for tz in Asia/Ho_Chi_Minh UTC America/Los_Angeles; do echo "== logic TZ=$tz"; TZ=$tz npx --no-install tsx tests/logic.test.ts | grep -E "^(FAIL|====)|^       "; done
echo "== e2e (Chromium)"; (node tests/e2e.cjs | grep -E "^(FAIL|====)|^       |HARNESS")

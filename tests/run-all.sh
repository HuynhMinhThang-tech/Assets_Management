#!/bin/bash
# Chạy toàn bộ test OFFLINE (không cần npm install): esbuild + Chromium + stub lucide-react.
# Yêu cầu: node, tsx, playwright (+ chromium) cài global; NODE_PATH trỏ tới global node_modules.
set -e
cd "$(dirname "$0")/.."
G=${NODE_PATH:-$(npm root -g)}
export NODE_PATH=$G
mkdir -p node_modules/lucide-react tests/dist
echo '{"name":"lucide-react","type":"module","main":"index.js"}' > node_modules/lucide-react/package.json
for m in react react-dom; do [ -e node_modules/$m ] || ln -s $G/$m node_modules/$m; done
bash tests/gen-stubs.sh
ESB=$G/tsx/node_modules/esbuild/bin/esbuild
$ESB src/main.tsx --bundle --outfile=tests/dist/app.js --format=iife --jsx=automatic --platform=browser --loader:.css=empty --define:process.env.NODE_ENV=\"development\" --log-level=warning
FAILS=0
check() { # in kết quả cô đọng và đếm lỗi
  local out; out=$("$@" 2>&1) || FAILS=$((FAILS+1))
  echo "$out" | grep -E "^(FAIL|====)|^       |HARNESS|^# (pass|fail)|^(not ok)|^Ran |^OK|^FAILED" || true
}
for tz in Asia/Ho_Chi_Minh UTC America/Los_Angeles; do
  for t in logic phase1 phase2 phase3 phase4 phase5 balanceSheet loans edits positions valuation consistency; do
    echo "== $t TZ=$tz"; TZ=$tz check npx --no-install tsx tests/$t.test.ts
  done
done
echo "== api (máy chủ, DB giả)"; check npx --no-install tsx --test tests/api/handlers.test.ts tests/api/syncer.test.ts tests/api/prices.test.ts
echo "== python (script lấy giá)"; check python3 -m unittest discover -s tests/python
echo "== giao diện: hộp thoại mới + điện thoại (Chromium, Tailwind ngoại tuyến)"; check node tests/ui-smoke.cjs
echo "== giao diện: tab Cập nhật giá (Chromium)"; check node tests/prices-ui.cjs
echo "== PWA: manifest, biểu tượng, service worker, ngoại tuyến, nút cài (Chromium)"; check node tests/pwa.cjs
if [ "${E2E:-0}" = "1" ]; then echo "== e2e cũ (Chromium; hiện hỏng sẵn vì app đã có đăng nhập/API)"; check node tests/e2e.cjs; fi
echo; if [ "$FAILS" -gt 0 ]; then echo "CÓ $FAILS NHÓM TEST LỖI"; exit 1; else echo "TẤT CẢ NHÓM TEST ĐẠT"; fi

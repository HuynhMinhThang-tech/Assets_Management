/** Dựng CSS Tailwind (v4) ngoại tuyến từ các lớp dùng trong src/ để kiểm tra bố cục thật trong Chromium. */
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const G = process.env.NODE_PATH || require('child_process').execFileSync('npm', ['root', '-g']).toString().trim();
const findTw = () => { for (const base of [path.join(root, 'node_modules'), '/opt/npm-tools/node_modules', G]) { const dir = path.join(base, 'tailwindcss'); if (fs.existsSync(path.join(dir, 'package.json'))) return dir; } throw new Error('Không tìm thấy tailwindcss'); };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = [...walk(path.join(root, 'src')), path.join(root, 'index.html'), path.join(root, 'tests/ui-smoke.entry.tsx')].filter((f) => /\.(tsx?|html)$/.test(f));
const cands = new Set();
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/[^\s"'`<>{}=;,]+/g)) cands.add(m[0]);
(async () => {
  const dir = findTw();
  const tw = { dir, mod: await import(require('url').pathToFileURL(path.join(dir, 'dist/lib.mjs')).href) };
  const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  const compiler = await tw.mod.compile(css, {
    base: root,
    loadStylesheet: async (id, base) => {
      if (id === 'tailwindcss') return { path: 'index.css', base: tw.dir, content: fs.readFileSync(path.join(tw.dir, 'index.css'), 'utf8') };
      const rel = id.startsWith('tailwindcss/') ? path.join(tw.dir, id.slice('tailwindcss/'.length) + (id.endsWith('.css') ? '' : '.css')) : path.resolve(base, id);
      return { path: rel, base: path.dirname(rel), content: fs.readFileSync(rel, 'utf8') };
    },
  });
  const out = compiler.build([...cands]);
  fs.mkdirSync(path.join(root, 'tests/dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests/dist/app.css'), out);
  console.log('CSS', out.length, 'bytes');
})().catch((e) => { console.error(e); process.exit(1); });

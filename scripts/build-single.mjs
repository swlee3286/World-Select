// 게임 전체(코드, 지도 데이터, 스타일)를 HTML 파일 하나로 묶어요. → dist/world-draw.html
// 로컬 서버 없이 열거나 한 파일로 배포할 때 써요. 실행: npm run build:single
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const embedded = fileURLToPath(new URL('./data-embedded.js', import.meta.url));

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2022',
  plugins: [{
    name: 'embed-data',
    setup(b) {
      b.onResolve({ filter: /\/data\.js$/ }, (args) => (args.importer.includes('/src/') ? { path: embedded } : undefined));
    },
  }],
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('styles.css', 'utf8');
const html = readFileSync('index.html', 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();
const title = html.match(/<title>(.*?)<\/title>/)[1];

const single = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<style>
${css}</style>
</head>
<body>
${body}
<script>
${js}</script>
</body>
</html>
`;
// 문서 틀(<html>, <head>, <body>)을 바깥에서 씌워 주는 곳(Claude 아티팩트 등)에 올릴 때 쓰는 조각
const fragment = `<title>${title}</title>
<style>
${css}</style>
${body}
<script>
${js}</script>
`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/world-draw.html', single);
writeFileSync('dist/world-draw.fragment.html', fragment);
console.log(`dist/world-draw.html ${(single.length / 1024).toFixed(0)}KB`);

#!/usr/bin/env node
/*
 * build-shell.js — 从共用内核生成某个伪装外壳的 www 目录
 *
 *   node tools/build-shell.js --shell=weather --out=app/www
 *
 * 背景：以前 ghostchat / gc-calculator / gc-weather 各存一份 index.html，靠手工
 * 复制保持同步。三份之间已经漂出 400~700 行差异，而且几乎全是应用名和主题色这种
 * 纯外观的东西。现在内核只有 ghostchat 一份，外壳差异全部收敛到 shells/shells.json，
 * 由这个脚本在构建时套上去。
 *
 * 脚本只做确定性的字符串替换，不解析 HTML —— 出错要能一眼看出来，而不是悄悄
 * 生成一个能跑但少了半个界面的包。每一步替换都会校验命中次数，对不上直接退出。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [m[1], m[2] || true] : [a, true];
  })
);

const shellId = args.shell;
const outDir = path.resolve(args.out || 'dist');
if (!shellId) die('用法: node tools/build-shell.js --shell=<id> [--out=<dir>]');

function die(msg) { console.error('✗ ' + msg); process.exit(1); }
function info(msg) { console.log('  ' + msg); }

const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'shells/shells.json'), 'utf8'));
const shell = conf.shells[shellId];
if (!shell) die(`未知外壳 "${shellId}"，可选: ${Object.keys(conf.shells).join(', ')}`);

// 内核里作为品牌占位的字符串。改这个名字要连带改 shells.json 的注释。
const CORE_BRAND = 'GhostChat';

// 复制到 www 的内核文件；vendor/lang 是整目录
const FILES = ['index.html', 'chat-core.js', 'i18n.js', 'sw.js', 'webrtc.js', 'register.js',
  'supabase-config.js', 'manifest.json', 'OneSignalSDKWorker.js',
  'icon192.png', 'icon512.png', 'icon-maskable.png', 'apple-touch-icon.png'];
const DIRS = ['lang', 'vendor'];

// 会被套上品牌的文本文件（二进制和第三方库不碰）
const BRANDED = new Set(['index.html', 'chat-core.js', 'i18n.js', 'manifest.json']);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

console.log(`\n构建外壳: ${shellId}  (${shell.brand} / ${shell.package})`);

let brandHits = 0;
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { info(`跳过（内核没有）: ${f}`); continue; }
  if (!BRANDED.has(f)) { fs.copyFileSync(src, path.join(outDir, f)); continue; }
  let txt = fs.readFileSync(src, 'utf8');
  const n = txt.split(CORE_BRAND).length - 1;
  brandHits += n;
  txt = txt.split(CORE_BRAND).join(shell.brand);
  fs.writeFileSync(path.join(outDir, f), txt);
  info(`${f}: 替换品牌名 ${n} 处`);
}
for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(outDir, d), { recursive: true });
}
if (brandHits === 0) die(`内核里一处 "${CORE_BRAND}" 都没有 —— 占位串可能被改过，生成的包会是错的`);

// ── index.html：主题色 + 默认伪装 + 藏掉其他伪装入口 ──
const idxPath = path.join(outDir, 'index.html');
let idx = fs.readFileSync(idxPath, 'utf8');

const themeRe = /<meta name="theme-color" content="[^"]*" id="metaThemeColor">/;
if (!themeRe.test(idx)) die('找不到 theme-color meta 标签');
idx = idx.replace(themeRe, `<meta name="theme-color" content="${shell.themeColor}" id="metaThemeColor">`);

// 各伪装壳对应的界面元素：屏幕本体 + 设置里的选择项
const DISGUISE_NODES = {
  calculator: ['#dcalc', '#od-calc'],
  weather: ['#dweather', '#od-weat'],
  clock: ['#dclk', '#od-cloc'],
  note: ['#dnote', '#noteEditor', '#od-note'],
};
const hide = (shell.hide || []).flatMap(k => DISGUISE_NODES[k] || []);
let inject = `<style id="gc-shell-${shellId}">\n`;
if (hide.length) inject += hide.join(',') + '{display:none!important}\n';
inject += `</style>\n<script>
/* 首次安装时把默认伪装设成本外壳对应的那个；用户改过就不再覆盖。 */
(function(){try{
  if(!localStorage.getItem('dis'))localStorage.setItem('dis','${shell.disguise}');
}catch(e){}})();
</script>\n`;

const bodyIdx = idx.indexOf('<body>');
if (bodyIdx < 0) die('找不到 <body>');
idx = idx.slice(0, bodyIdx + 6) + '\n' + inject + idx.slice(bodyIdx + 6);
fs.writeFileSync(idxPath, idx);
info(`主题色 ${shell.themeColor}，默认伪装 ${shell.disguise}` +
  (hide.length ? `，隐藏 ${shell.hide.join('/')} 入口` : ''));

// ── manifest.json ──
const mfPath = path.join(outDir, 'manifest.json');
if (fs.existsSync(mfPath)) {
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  mf.name = shell.brand;
  mf.short_name = shell.brand;
  mf.theme_color = shell.themeColor;
  fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2) + '\n');
  info('manifest.json 已更新');
}

// ── 生成后自检：语法必须能过，关键界面不能少 ──
const finalHtml = fs.readFileSync(idxPath, 'utf8');
const blocks = finalHtml.match(/<script>([\s\S]*?)<\/script>/g) || [];
blocks.forEach((b, i) => {
  try { new Function(b.replace(/^<script>/, '').replace(/<\/script>$/, '')); }
  catch (e) { die(`生成的 index.html 第 ${i} 个 script 块语法错误: ${e.message}`); }
});
for (const must of ['id="dweather"', 'id="dcalc"', 'function loadWeather', 'tapSecret()']) {
  if (!finalHtml.includes(must)) die(`生成的 index.html 缺少 ${must}`);
}
// ghostchat 外壳的品牌名就等于占位串本身，这一条对它不适用
if (shell.brand !== CORE_BRAND && finalHtml.includes(CORE_BRAND)) {
  die(`生成的 index.html 里还残留 "${CORE_BRAND}"`);
}

console.log(`✓ ${shellId} → ${outDir}\n`);

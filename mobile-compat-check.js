/**
 * 手机端兼容性自动化检测脚本（Playwright）
 * ------------------------------------------------------------
 * 用法：
 *   node mobile-compat-check.js                         # 测本地 index.html（chromium，全部视口）
 *   node mobile-compat-check.js https://app.hoarfall.com/  # 测线上
 *   node mobile-compat-check.js --viewports smoke        # 仅关键 4 个视口（快）
 *   node mobile-compat-check.js --engine webkit          # 换内核（≈Safari iOS）
 *   node mobile-compat-check.js --engine all             # chromium + webkit + firefox
 *   node mobile-compat-check.js --json compat-report.json  # 输出 JSON 报告
 *
 * 依赖：npm i -D playwright && npx playwright install
 * 覆盖用例：TC-01 横向滚动 / TC-02 元素溢出 / TC-03 图片变形 /
 *          TC-04 图片放大模糊 / TC-05 文字溢出 / TC-06 点击区 /
 *          TC-07 viewport 配置 / TC-08 字体加载
 */

const { chromium, webkit, firefox } = require('playwright');
const path = require('path');
const fs = require('fs');

const DEFAULT_URL = 'file://' + path.resolve(__dirname, 'index.html');

const VIEWPORTS = [
  { name: 'iPhone SE1/低端 320', width: 320, height: 568, deviceScaleFactor: 2 },
  { name: '入门安卓 360',        width: 360, height: 640, deviceScaleFactor: 3 },
  { name: 'iPhone SE2/8 375',    width: 375, height: 667, deviceScaleFactor: 2 },
  { name: 'iPhone 12-15 390',    width: 390, height: 844, deviceScaleFactor: 3 },
  { name: 'Pixel/小米 393',      width: 393, height: 851, deviceScaleFactor: 2.75 },
  { name: '三星S/Pixel+ 412',    width: 412, height: 915, deviceScaleFactor: 3 },
  { name: 'iPhone ProMax 430',   width: 430, height: 932, deviceScaleFactor: 3 },
  { name: 'iPhone16PM 440',      width: 440, height: 956, deviceScaleFactor: 3 },
  { name: '大屏安卓 480',        width: 480, height: 800, deviceScaleFactor: 2 },
  { name: '折叠封面 280',        width: 280, height: 653, deviceScaleFactor: 3 },
  { name: 'iPad mini 竖 768',    width: 768, height: 1024, deviceScaleFactor: 2 },
  { name: 'iPad 竖 810',         width: 810, height: 1080, deviceScaleFactor: 2 },
];
const SMOKE_NAMES = ['iPhone SE2/8 375', 'iPhone 12-15 390', 'iPhone ProMax 430', '折叠封面 280'];

const ARGS = process.argv.slice(2);
const pick = (flag, def) => { const i = ARGS.indexOf(flag); return i >= 0 ? ARGS[i + 1] : def; };
const url = ARGS.find(a => !a.startsWith('--')) || DEFAULT_URL;
const engineArg = pick('--engine', 'chromium');
const vpArg = pick('--viewports', 'all');
const jsonOut = pick('--json', null);

const ENGINES = {
  chromium: { mod: chromium, label: 'Chrome/微信安卓/X5(Blink)' },
  webkit:   { mod: webkit,   label: 'Safari iOS(WebKit)' },
  firefox:  { mod: firefox,  label: 'Firefox(Gecko)' },
};
const engineList = engineArg === 'all' ? Object.keys(ENGINES) : [engineArg];
const viewports = vpArg === 'smoke' ? VIEWPORTS.filter(v => SMOKE_NAMES.includes(v.name)) : VIEWPORTS;

// 在页面上下文中执行检测（TC-01~TC-07）
function probeInPage() {
  const iw = window.innerWidth, ih = window.innerHeight, dpr = window.devicePixelRatio;
  const de = document.documentElement;
  const issues = [];

  // TC-01 横向滚动
  const hOverflow = de.scrollWidth - iw;
  if (hOverflow > 1) issues.push({ code: 'TC-01', sev: '高', msg: `横向溢出 ${hOverflow}px` });

  // TC-02 元素溢出画布
  let off = 0;
  document.querySelectorAll('*').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > iw + 1 || r.left < -1)) {
      off++;
      if (off <= 12) issues.push({ code: 'TC-02', sev: '高', tag: el.tagName, cls: (el.className || '').toString().slice(0, 36), right: Math.round(r.right), left: Math.round(r.left) });
    }
  });

  // TC-03 图片变形 / TC-04 图片放大模糊
  document.querySelectorAll('img').forEach((img, i) => {
    const r = img.getBoundingClientRect();
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh || r.width <= 0 || r.height <= 0) return;
    const arDiff = Math.abs(r.width / r.height - nw / nh) / (nw / nh);
    if (arDiff > 0.02) issues.push({ code: 'TC-03', sev: '中', img: i, msg: `宽高比差 ${(arDiff * 100).toFixed(1)}%` });
    if (r.width > nw * dpr * 1.05) issues.push({ code: 'TC-04', sev: '中', img: i, msg: `放大模糊 渲染${Math.round(r.width)}px>原生${nw}×DPR${dpr}=${Math.round(nw * dpr)}px` });
  });

  // TC-05 文字溢出
  document.querySelectorAll('h1,h2,h3,h4,p,a,button,span,div,li').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.overflow === 'auto' || cs.overflow === 'scroll' || cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
    if (el.scrollWidth - el.clientWidth > 1) issues.push({ code: 'TC-05', sev: '中', tag: el.tagName, cls: (el.className || '').toString().slice(0, 36), overflow: el.scrollWidth - el.clientWidth });
  });

  // TC-06 点击区域
  document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
      issues.push({ code: 'TC-06', sev: '中', tag: el.tagName, cls: (el.className || '').toString().slice(0, 36), w: Math.round(r.width), h: Math.round(r.height) });
  });

  // TC-07 viewport
  const vm = document.querySelector('meta[name="viewport"]');
  const vmc = vm ? vm.getAttribute('content') : '';
  if (!vm || !/width=device-width/.test(vmc)) issues.push({ code: 'TC-07', sev: '高', msg: 'viewport 缺失或不含 width=device-width' });

  return { iw, ih, dpr, offCount: off, viewportMeta: vmc, issues };
}

(async () => {
  const report = { url, engines: {}, generatedAt: new Date().toISOString() };
  let fatal = false;

  for (const eng of engineList) {
    const e = ENGINES[eng];
    if (!e) { console.log(`⚠️ 未知内核 ${eng}，跳过`); continue; }
    let browser;
    try {
      browser = await e.mod.launch({ headless: true });
    } catch (err) {
      console.log(`⚠️ ${eng} 浏览器未安装，跳过（npx playwright install ${eng}）：${String(err).split('\n')[0]}`);
      fatal = true;
      continue;
    }
    console.log(`\n===== 内核：${eng}（${e.label}） =====`);
    report.engines[eng] = { label: e.label, viewports: {} };

    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor });
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch (_) {}
        await page.waitForTimeout(400);
        const res = await page.evaluate(probeInPage);
        // TC-08 字体（软检查）
        let fontNote = 'n/a';
        try {
          const loaded = await page.evaluate(() => Array.from(document.fonts).map(f => `${f.family}:${f.status}`).slice(0, 6));
          fontNote = loaded.join(' | ');
        } catch (_) {}
        const high = res.issues.filter(i => i.sev === '高').length;
        const mid = res.issues.filter(i => i.sev === '中').length;
        const tag = high > 0 ? '❌' : (mid > 0 ? '⚠️' : '✅');
        console.log(`${tag} ${vp.name.padEnd(18)} ${vp.width}x${vp.height}@${vp.deviceScaleFactor}  高:${high} 中:${mid} 溢出元素:${res.offCount}`);
        if (res.issues.length) res.issues.forEach(i => console.log('      · ' + JSON.stringify(i)));
        report.engines[eng].viewports[vp.name] = { ...res, fontSample: fontNote };
      } catch (err) {
        console.log(`❌ ${vp.name} 执行失败：${String(err).split('\n')[0]}`);
        report.engines[eng].viewports[vp.name] = { error: String(err).split('\n')[0] };
      }
      await ctx.close();
    }
    await browser.close();
  }

  if (jsonOut) { fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(report, null, 2)); console.log(`\n📄 报告已写出：${jsonOut}`); }
  if (fatal) console.log('\n提示：部分内核浏览器未安装，运行 `npx playwright install` 后再测。');
})();

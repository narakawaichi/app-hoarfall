/**
 * Cloudflare Worker —— 永久边缘缓存（标准可用版）
 * --------------------------------------------------------------------------
 * 作用：把所有 GET 响应缓存到 Cloudflare 边缘节点，命中后直接由缓存返回，
 *       不再回源，大幅降低首字节延迟与源站/R2 压力。
 *
 * 部署方式（任选其一）：
 *   A. 纯 Worker（推荐，套在站点前面）：
 *        npm i -g wrangler
 *        wrangler login
 *        wrangler deploy            # 用同目录 wrangler.toml 里的 name / route 绑定域名
 *      或在 CF 后台 Dashboard → Workers & Pages → 你的 Worker → Triggers → Routes
 *      绑定到下载页域名（如 download.hoarfall.com/*）。
 *
 *   B. Cloudflare Pages：把本文件改名为  functions/[[path]].js  放到项目根目录即可，
 *      无需 wrangler.toml，Pages 会自动用它做边缘中间件。
 *
 * 缓存策略：
 *   - 静态资源（css/js/图片/字体/视频…）：永久缓存（max-age=1年 + immutable）。
 *   - HTML/其他文档：默认长缓存 + 后台重验（stale-while-revalidate）。
 *     把下方 PERMANENT_HTML 改为 true 可让 HTML 也永久缓存，
 *     但发布更新后需到 CF 后台 “Caching → Purge Everything” 才会生效。
 *   - 带 Range 的请求（音视频拖动）与 非 GET 请求：不缓存，直接回源。
 *
 * 自测：部署后访问页面，刷新一次，看响应头 CF-Cache-Status 从 MISS 变 HIT 即生效。
 * --------------------------------------------------------------------------
 */

const ONE_YEAR = 31536000;

// true = HTML 也永久缓存（发布后必须手动 Purge 才会更新）
const PERMANENT_HTML = false;

// 需要“永久缓存”的静态资源扩展名
const ASSET_RE = /\.(css|js|mjs|json|map|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|pdf|webmanifest)$/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 只缓存 GET；非 GET（POST 等）直接回源
    if (request.method !== 'GET') {
      return fetch(request);
    }

    // 带 Range 的请求（视频/音频拖动播放）不进缓存，避免产生碎片缓存
    if (request.headers.has('range')) {
      return fetch(request);
    }

    const cache = caches.default;

    // 用完整 URL 作缓存键（含 query，?v=xxx 等版本号天然形成不同缓存副本）
    let response = await cache.match(request);
    if (response) {
      const h = new Headers(response.headers);
      h.set('CF-Cache-Status', 'HIT');
      h.set('X-Cache', 'HIT');
      return new Response(response.body, { status: response.status, headers: h });
    }

    response = await fetch(request);

    // 仅缓存成功的 200 响应
    if (response.status === 200 && response.ok) {
      const isAsset = ASSET_RE.test(url.pathname);
      const cached = new Response(response.body, response);
      const h = new Headers(cached.headers);

      if (isAsset || PERMANENT_HTML) {
        // 静态资源 / 或开启永久 HTML：永久缓存，浏览器不再向源站确认
        h.set('Cache-Control', `public, max-age=${ONE_YEAR}, immutable`);
      } else {
        // HTML 文档：长缓存 + 后台重验，发布后最多 7 天内自动刷新，或手动 Purge 即时生效
        h.set('Cache-Control', `public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800`);
      }

      // 基础安全 / SEO 头
      h.set('X-Content-Type-Options', 'nosniff');
      h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      h.set('CF-Cache-Status', 'MISS');
      h.set('X-Cache', 'MISS');

      // 异步写入边缘缓存，不阻塞本次响应
      ctx.waitUntil(cache.put(request, cached.clone()));

      return new Response(cached.body, { status: cached.status, headers: h });
    }

    // 非 200（3xx/4xx/5xx）直接透传，不缓存
    return response;
  },
};

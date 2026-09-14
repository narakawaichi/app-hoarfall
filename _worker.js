/**
 * Cloudflare Pages —— _worker.js（边缘永久缓存，统一接管静态资源）
 * --------------------------------------------------------------------------
 * 部署：Cloudflare Pages 连接 GitHub 仓库后，本文件即边缘中间件，
 *       每个请求都会经过这里。静态文件由 Pages Assets 提供（env.ASSETS.fetch），
 *       本 Worker 负责加 Cache-Control + 边缘 Cache API 永久缓存。
 *
 * 缓存策略：
 *   - 静态资源（css/js/图片/字体/视频…）：永久缓存（max-age=1年 + immutable）。
 *   - HTML/其他文档：长缓存 + 后台重验（stale-while-revalidate）。
 *     把下方 PERMANENT_HTML 改为 true 可让 HTML 也永久缓存（发布后需 Purge 才更新）。
 *   - Range 请求（音视频拖动）与非 GET：绕过缓存，直接交给 Assets。
 *
 * 自测：访问页面刷新一次，看响应头 CF-Cache-Status 从 MISS 变 HIT 即生效。
 * --------------------------------------------------------------------------
 */

const ONE_YEAR = 31536000;

// true = HTML 也永久缓存（发布后必须到 CF 后台 Caching → Purge Everything 才更新）
const PERMANENT_HTML = false;

// 需要“永久缓存”的静态资源扩展名
const ASSET_RE = /\.(css|js|mjs|json|map|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|pdf|webmanifest)$/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 优先用 Pages Assets 提供静态文件（避免 _worker.js 自己调自己死循环）；
    // 没有 assets 绑定的纯 Worker 场景则回退到普通 fetch。
    const serve = (req) => (env.ASSETS ? env.ASSETS.fetch(req) : fetch(req));

    // 非 GET 或带 Range（音视频拖动）：直接交给 Assets，不走缓存
    if (request.method !== 'GET' || request.headers.has('range')) {
      return serve(request);
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

    response = await serve(request);

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

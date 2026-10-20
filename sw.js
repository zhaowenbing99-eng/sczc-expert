/* 离线缓存：让「添加到主屏幕」后无网也能用
 *
 * 策略（很重要）：
 *   · 导航请求（打开页面）→ 网络优先，失败才用缓存。这样更新后刷新就能拿到新版。
 *   · 静态资源 → stale-while-revalidate：先用缓存秒开，同时后台拉新版。
 *   · 版本号由构建注入，换版本会清掉旧缓存。
 *
 * 注意：Service Worker 只在 https 或 localhost 下生效；
 * 通过局域网 IP（http://192.168.x.x）访问时浏览器会拒绝注册，属于正常现象，
 * 此时系统仍可正常使用，只是没有离线缓存。
 */
const V = '20261020044028';
const CACHE = 'sczc-' + V;
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './data.bundle.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

function put(req, res) {
  if (!res || res.status !== 200 || res.type !== 'basic') return res;
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  return res;
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // 逐个用 cache:'reload' 抓取，避免把 HTTP 缓存里的旧版本钉进 SW 缓存
      await Promise.all(ASSETS.map((url) =>
        fetch(new Request(url, { cache: 'reload' }))
          .then((res) => { if (res && res.status === 200 && res.type === 'basic') return c.put(url, res); })
          .catch(() => {})
      ));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 1) 页面导航：网络优先
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => put(req, res))
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match(req)))
    );
    return;
  }

  // 2) 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((res) => put(req, res)).catch(() => hit);
      return hit || net;
    })
  );
});

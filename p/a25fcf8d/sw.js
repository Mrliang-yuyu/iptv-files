// IPTV Player - Service Worker
// Proxies HTTP video streams from HTTPS pages (bypasses mixed content blocking)
const CACHE = 'iptv-player-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // Proxy endpoint: /proxy/ + base64 or encoded URL
  // Proxy: intercept requests to /p/a25fcf8d/proxy/...
  const proxyPrefix = '/p/a25fcf8d/proxy/';
  if (url.pathname.startsWith(proxyPrefix)) {
    e.respondWith(proxyStream(e.request, url, proxyPrefix));
    return;
  }
  
  // Cache static assets (player page, manifest, etc.)
  if (url.hostname === 'iptv-live-btg.pages.dev' && url.pathname.startsWith('/p/a25fcf8d/')) {
    e.respondWith(cacheFirst(e.request));
  }
});

async function proxyStream(request, url, prefix) {
  // Extract target URL from path: /p/a25fcf8d/proxy/URL_PREFIXED
  const encoded = url.pathname.slice(prefix.length);
  let target;
  try {
    target = atob(encoded);
  } catch(e) {
    target = decodeURIComponent(encoded);
  }
  
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    return new Response('Invalid stream URL', { status: 400 });
  }

  try {
    const resp = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 IPTV-Player/1.0',
        'Referer': target.replace(/\/[^/]*$/, '/')
      }
    });
    
    const h = new Headers(resp.headers);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: h
    });
  } catch(e) {
    return new Response('Stream unavailable: ' + e.message, { status: 502 });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  if (resp.ok && resp.type === 'basic') {
    const clone = resp.clone();
    caches.open(CACHE).then(cache => cache.put(request, clone));
  }
  return resp;
}

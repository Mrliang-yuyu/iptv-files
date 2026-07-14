// IPTV Player - Service Worker
// Proxies HTTP video streams from HTTPS pages (bypasses mixed content blocking)
const CACHE = 'iptv-player-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // Proxy stream requests: /p/a25fcf8d/proxy/URL-ENCODED
  const proxyPrefix = '/p/a25fcf8d/proxy/';
  if (url.pathname.startsWith(proxyPrefix)) {
    e.respondWith(proxyStream(e.request, url, proxyPrefix));
    return;
  }
  
  // Cache static assets (not streams)
  if (url.hostname === 'iptv-live-btg.pages.dev' && url.pathname.startsWith('/p/a25fcf8d/')) {
    // Don't cache .m3u/.ts/.m3u8 paths
    if (!url.pathname.match(/\.(m3u8?|ts|mp4|flv|mkv|aac|mp3)$/i)) {
      e.respondWith(cacheFirst(e.request));
    }
  }
});

async function proxyStream(request, url, prefix) {
  const encoded = url.pathname.slice(prefix.length);
  let target;
  try {
    target = decodeURIComponent(encoded);
  } catch(e) {
    try { target = atob(encoded); } catch(e2) { target = encoded; }
  }
  
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    return new Response('Invalid stream URL', { status: 400, statusText: 'Bad Request' });
  }

  try {
    // Forward important headers from original request (Range for seeking)
    const reqHeaders = {};
    if (request.headers.get('Range')) {
      reqHeaders['Range'] = request.headers.get('Range');
    }
    reqHeaders['User-Agent'] = 'Mozilla/5.0 IPTV-Player/1.0';
    reqHeaders['Referer'] = target.replace(/\/[^/]*$/, '/');

    const resp = await fetch(target, { headers: reqHeaders });
    
    const h = new Headers(resp.headers);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    h.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: h
    });
  } catch(e) {
    return new Response('Stream unavailable: ' + e.message, {
      status: 502,
      statusText: 'Bad Gateway'
    });
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

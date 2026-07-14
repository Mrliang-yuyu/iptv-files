// IPTV Player - Service Worker
// Proxies HTTP video streams from HTTPS pages (bypasses mixed content blocking)
// Also rewrites m3u8 playlists: follows redirects, resolves relative URLs to absolute
const CACHE = 'iptv-player-v3';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(clients.claim()); });

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
    if (!url.pathname.match(/\.(m3u8?|ts|mp4|flv|mkv|aac|mp3)$/i)) {
      e.respondWith(cacheFirst(e.request));
    }
  }
});

async function proxyStream(request, url, prefix) {
  const encoded = url.pathname.slice(prefix.length);
  let target;
  try { target = decodeURIComponent(encoded); }
  catch(e) { try { target = atob(encoded); } catch(e2) { target = encoded; } }
  
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    return new Response('Invalid', { status: 400 });
  }

  try {
    // Fetch the target, follow redirects
    const reqHeaders = {};
    if (request.headers.get('Range')) reqHeaders['Range'] = request.headers.get('Range');
    reqHeaders['User-Agent'] = 'Mozilla/5.0 IPTV-Proxy/1.0';
    
    const resp = await fetch(target, { headers: reqHeaders });
    const ct = (resp.headers.get('Content-Type') || '').toLowerCase();
    
    // Check if this is an m3u8 playlist (need to rewrite relative URLs)
    if (ct.includes('mpegurl') || ct.includes('x-mpegurl') || target.match(/\.m3u8?$/i)) {
      const text = await resp.text();
      const lines = text.split('\n');
      const rewritten = [];
      
      // Determine base URL: use the response URL (after redirects)
      let baseUrl = resp.url || target;
      let baseDir = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
      
      for (let line of lines) {
        let trimmed = line.trim();
        // If line looks like a URL/ path (not a comment/tag/empty)
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
          try {
            // Check if already absolute
            if (trimmed.match(/^https?:\/\//i)) {
              // Absolute HTTP URL → proxy it too
              if (trimmed.startsWith('http://')) {
                let proxied = '/p/a25fcf8d/proxy/' + encodeURIComponent(trimmed);
                rewritten.push(proxied);
              } else {
                rewritten.push(trimmed);
              }
            } else {
              // Relative URL → resolve against base, then proxy
              let absolute = new URL(trimmed, baseDir).href;
              if (absolute.startsWith('http://')) {
                let proxied = '/p/a25fcf8d/proxy/' + encodeURIComponent(absolute);
                rewritten.push(proxied);
              } else {
                rewritten.push(absolute);
              }
            }
          } catch(e) {
            rewritten.push(line);
          }
        } else {
          rewritten.push(line);
        }
      }
      
      const newBody = rewritten.join('\n');
      const h = new Headers();
      h.set('Content-Type', 'application/vnd.apple.mpegurl');
      h.set('Access-Control-Allow-Origin', '*');
      h.set('Cache-Control', 'no-cache');
      return new Response(newBody, { status: 200, headers: h });
    }
    
    // Not a playlist - just proxy the response
    const h = new Headers(resp.headers);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    h.set('Cache-Control', 'no-cache');
    return new Response(resp.body, { status: resp.status, headers: h });
    
  } catch(e) {
    return new Response('Error: ' + e.message, { status: 502 });
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

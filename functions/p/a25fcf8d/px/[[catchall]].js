// IPTV Stream Proxy — bypasses mixed-content blocking for HTTP video streams
// Served via Cloudflare Pages Functions at the same domain.
// Request pattern: /p/a25fcf8d/px/{encodeURIComponent(targetUrl)}
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const proxyPath = url.pathname.replace('/p/a25fcf8d/px/', '');

  if (!proxyPath) return new Response('Missing target URL', { status: 400 });

  let target;
  try { target = decodeURIComponent(proxyPath); }
  catch { return new Response('Invalid encoding', { status: 400 }); }

  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    return new Response('Invalid protocol', { status: 400 });
  }

  const headers = { 'User-Agent': 'Mozilla/5.0 IPTV-Proxy/1.0' };
  if (request.headers.get('Range')) headers.Range = request.headers.get('Range');

  try {
    const resp = await fetch(target, { headers });
    const ct = (resp.headers.get('Content-Type') || '').toLowerCase();

    // ── m3u8 playlist: rewrite relative/sibling URLs through proxy ──
    if (ct.includes('mpegurl') || ct.includes('x-mpegurl') || /\.m3u8?$/i.test(target)) {
      const text = await resp.text();
      const baseDir = (resp.url || target).replace(/\/[^/]*$/, '/');
      const lines = text.split('\n');
      const rewritten = lines.map(line => {
        const t = line.trim();
        if (!t || t.startsWith('#') || t.startsWith('//')) return line;
        try {
          const abs = /^https?:\/\//i.test(t) ? t : new URL(t, baseDir).href;
          if (!abs.startsWith('http://')) return abs;
          return '/p/a25fcf8d/px/' + encodeURIComponent(abs);
        } catch { return line; }
      });

      return new Response(rewritten.join('\n'), {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store',
          'CDN-Cache-Control': 'no-store',
        },
      });
    }

    // ── Direct stream proxy (MPEG-TS / .ts segments / etc.) ──
    const h = new Headers();
    // Only forward essential headers
    const ct = resp.headers.get('Content-Type');
    if (ct) h.set('Content-Type', ct);
    const cl = resp.headers.get('Content-Length');
    if (cl) h.set('Content-Length', cl);
    const range = resp.headers.get('Content-Range');
    if (range) h.set('Content-Range', range);
    const accept = resp.headers.get('Accept-Ranges');
    if (accept) h.set('Accept-Ranges', accept);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Cache-Control', 'no-cache, no-store');
    h.set('CDN-Cache-Control', 'no-store');
    return new Response(resp.body, { status: resp.status, headers: h });

  } catch (e) {
    return new Response('Proxy Error: ' + e.message, { status: 502 });
  }
}

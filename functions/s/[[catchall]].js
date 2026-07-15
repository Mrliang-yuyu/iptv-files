// IPTV Stream Proxy
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const encoded = url.pathname.replace('/s/', '');
  if (!encoded) return new Response('Missing URL', { status: 400 });
  let target;
  try { target = decodeURIComponent(encoded); }
  catch(e) { return new Response('Invalid', { status: 400 }); }
  if (!target.startsWith('http://') && !target.startsWith('https://'))
    return new Response('Bad protocol', { status: 400 });

  const headers = { 'User-Agent': 'Mozilla/5.0 IPTV-Proxy/1.0' };
  if (context.request.headers.get('Range'))
    headers['Range'] = context.request.headers.get('Range');

  try {
    const resp = await fetch(target, { headers });
    const ct = (resp.headers.get('Content-Type') || '').toLowerCase();
    if (ct.includes('mpegurl') || ct.includes('x-mpegurl') || /\.m3u8?$/i.test(target)) {
      const text = await resp.text();
      const baseDir = (resp.url || target).replace(/\/[^/]*$/, '/');
      const lines = text.split('\n').map(line => {
        const t = line.trim();
        if (!t || t.startsWith('#') || t.startsWith('//')) return line;
        try {
          const abs = /^https?:\/\//i.test(t) ? t : new URL(t, baseDir).href;
          if (!abs.startsWith('http://')) return abs;
          return '/s/' + encodeURIComponent(abs);
        } catch(e) { return line; }
      });
      return new Response(lines.join('\n'), {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        }
      });
    }
    const h = new Headers(resp.headers);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Cache-Control', 'no-store');
    h.set('CDN-Cache-Control', 'no-store');
    return new Response(resp.body, { status: 200, headers: h });
  } catch(e) {
    return new Response('Error: ' + e.message, { status: 502 });
  }
}

// CF Pages Worker: proxy HTTP streams for IPTV player
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Test endpoint
    if (path === '/__worker_test') {
      return new Response('Worker OK: ' + request.method, { headers: { 'Content-Type': 'text/plain' } });
    }

    // Stream proxy: /p/URL-ENCODED-TARGET
    if (path.startsWith('/p/')) {
      const encoded = path.slice(3);
      // Decode the target URL
      const target = decodeURIComponent(encoded);
      
      // Must be http or https
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        return new Response('Proxy: invalid target [' + target + ']', { status: 400, headers: { 'Content-Type': 'text/plain' } });
      }

      try {
        const resp = await fetch(target, {
          headers: { 'User-Agent': 'Mozilla/5.0 IPTV-Proxy/1.0' }
        });
        const h = new Headers(resp.headers);
        h.set('Access-Control-Allow-Origin', '*');
        h.set('Cache-Control', 'no-cache');
        return new Response(resp.body, { status: resp.status, headers: h });
      } catch(e) {
        return new Response('Proxy error: ' + e.message, { status: 502, headers: { 'Content-Type': 'text/plain' } });
      }
    }

    // Static assets
    try {
      const resp = await fetch(request);
      const h = new Headers(resp.headers);
      h.set('Access-Control-Allow-Origin', '*');
      return new Response(resp.body, { status: resp.status, headers: h });
    } catch(e) {
      return new Response('Not found', { status: 404 });
    }
  }
};

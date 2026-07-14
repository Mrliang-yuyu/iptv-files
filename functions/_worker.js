// CF Pages Worker: handles stream proxy + static assets
export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Stream proxy endpoint
    if (url.pathname === '/pstream') {
      const target = url.searchParams.get('url');
      if (!target || (!target.startsWith('http://') && !target.startsWith('https://'))) {
        return new Response('', { status: 400 });
      }
      try {
        const resp = await fetch(target, {
          headers: { 'User-Agent': 'Mozilla/5.0 IPTV-Proxy/1.0' }
        });
        const h = new Headers(resp.headers);
        h.set('Access-Control-Allow-Origin', '*');
        return new Response(resp.body, { status: resp.status, headers: h });
      } catch(e) {
        return new Response('', { status: 502 });
      }
    }
    
    if (request.method === 'OPTIONS') {
      return new Response('', {
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS' }
      });
    }
    
    // Everything else: serve static assets
    return fetch(request);
  }
};

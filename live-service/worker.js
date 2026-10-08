/* tournament-live — stores tournaments so families can follow a live link.
   Cloudflare Worker with one D1 database bound as DB.

   POST /t          create a tournament     -> { id, key }   (key is the private edit key)
   PUT  /t/:id      update (header X-Edit-Key)
   GET  /t/:id      read                     -> { updated, data }   (?since=<updated> -> 204 if unchanged)
   GET  /health     check the service is up
*/
const ALLOWED = [
  'https://tournament.stingerz-baseball.com',
  'https://keubanks16.github.io',
  'http://localhost:8767'
];
const MAX_BYTES = 400 * 1024;

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(o) ? o : ALLOWED[0],
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Edit-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(req, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function rand(n, alphabet) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, x => alphabet[x % alphabet.length]).join('');
}
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}
async function readBody(req) {
  const text = await req.text();
  if (text.length > MAX_BYTES) throw new Error('too-big');
  JSON.parse(text); // must be valid JSON
  return text;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (url.pathname === '/health') return json(req, { ok: true, db: !!env.DB });
    if (!env.DB) return json(req, { error: 'Database is not connected to this service.' }, 500);

    const origin = req.headers.get('Origin') || '';
    const writing = req.method === 'POST' || req.method === 'PUT';
    if (writing && !ALLOWED.includes(origin)) return json(req, { error: 'Not allowed.' }, 403);

    try {
      if (req.method === 'POST' && url.pathname === '/t') {
        const data = await readBody(req);
        const key = rand(32, 'abcdefghijklmnopqrstuvwxyz0123456789');
        const now = Date.now();
        for (let i = 0; i < 5; i++) {
          const id = rand(8, 'abcdefghjkmnpqrstuvwxyz23456789');
          try {
            await env.DB.prepare('INSERT INTO tournaments (id, key_hash, data, updated, created) VALUES (?, ?, ?, ?, ?)')
              .bind(id, await sha256(key), data, now, now).run();
            return json(req, { id, key, updated: now }, 201);
          } catch (e) { /* id collision, try again */ }
        }
        return json(req, { error: 'Could not create.' }, 500);
      }

      const m = url.pathname.match(/^\/t\/([a-z0-9]{8})$/);
      if (!m) return json(req, { error: 'Not found.' }, 404);
      const id = m[1];

      if (req.method === 'GET') {
        const since = +url.searchParams.get('since') || 0;
        const row = await env.DB.prepare('SELECT data, updated FROM tournaments WHERE id = ?').bind(id).first();
        if (!row) return json(req, { error: 'This live link has ended.' }, 404);
        if (since && row.updated <= since) return new Response(null, { status: 204, headers: { ...cors(req), 'Cache-Control': 'no-store' } });
        return new Response(`{"updated":${row.updated},"data":${row.data}}`, { headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      }

      if (req.method === 'PUT') {
        const key = req.headers.get('X-Edit-Key') || '';
        const row = await env.DB.prepare('SELECT key_hash FROM tournaments WHERE id = ?').bind(id).first();
        if (!row) return json(req, { error: 'Not found.' }, 404);
        if (row.key_hash !== await sha256(key)) return json(req, { error: 'Wrong edit key.' }, 403);
        const data = await readBody(req);
        const now = Date.now();
        await env.DB.prepare('UPDATE tournaments SET data = ?, updated = ? WHERE id = ?').bind(data, now, id).run();
        return json(req, { ok: true, updated: now });
      }
      return json(req, { error: 'Not allowed.' }, 405);
    } catch (e) {
      if (e && e.message === 'too-big') return json(req, { error: 'Tournament is too large.' }, 413);
      return json(req, { error: 'Bad request.' }, 400);
    }
  }
};

/** Local dev server mimicking Vercel's function contract. Not shipped. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.status = code => { res.statusCode = code; return res; };

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
    try {
      const mod = await import(`../api/${name}.js?t=${Date.now()}`);
      return void await mod.default(req, res);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({ error: `No handler "${name}": ${e.message}` }));
    }
  }

  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const body = await readFile(join(process.cwd(), 'public', file));
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => console.error(`dev server on http://localhost:${PORT}`));

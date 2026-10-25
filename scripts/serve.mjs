import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const mime = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8' };
export async function startServer(root = 'site', port = 4173) {
  root = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    try {
      let relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (relative.endsWith('/')) relative += 'index.html';
      const file = path.resolve(root, '.' + relative);
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
    } catch { res.writeHead(404).end('Not found'); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  console.log(`[preview] http://127.0.0.1:${server.address().port}`);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await startServer(process.argv[2] || 'site');

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.env.PORT || 6006);
const publicDir = resolve('public');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
};

function resolvePublicPath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const safePath = normalize(pathname).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = join(publicDir, safePath === '/' ? 'index.html' : safePath);
  const resolved = resolve(filePath);

  if (!resolved.startsWith(publicDir)) {
    return null;
  }

  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return join(resolved, 'index.html');
  }

  return resolved;
}

const server = createServer((req, res) => {
  const filePath = resolvePublicPath(req.url || '/');

  if (!filePath || !existsSync(filePath)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
    'cache-control': 'no-store',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-opener-policy': 'same-origin',
  });

  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`Web ASR app: http://localhost:${port}`);
});

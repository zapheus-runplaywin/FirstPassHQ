// Serves an `expo export -p web` folder for the browser smoke tests, with the
// same routing as the screenshot tooling's serve.py: /a/b is a/b.html, a folder
// route is its index.html, and a dynamic segment is any [param].html beside it.
// Usage: node e2e/serve.mjs <export folder> [port]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'e2e/web-build');
const port = Number(process.argv[3] ?? 8123);

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`No web build in ${root}. Run "npm run e2e:build" first.`);
  process.exit(1);
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const isFile = (file) => fs.existsSync(file) && fs.statSync(file).isFile();

/** The file for a request path, following serve.py's rules. */
function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const full = path.join(root, path.normalize(clean).replace(/^([/\\])+/, ''));
  // Never serve anything outside the export folder.
  if (!full.startsWith(root)) return null;
  if (isFile(full)) return full;
  if (isFile(full + '.html')) return full + '.html';
  if (isFile(path.join(full, 'index.html'))) return path.join(full, 'index.html');
  if (clean === '' || clean === '/') return path.join(root, 'index.html');
  const parent = path.dirname(full);
  if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
    const dynamic = fs
      .readdirSync(parent)
      .sort()
      .find((name) => name.startsWith('[') && name.endsWith('].html'));
    if (dynamic) return path.join(parent, dynamic);
  }
  return null;
}

http
  .createServer((req, res) => {
    const file = resolve(req.url ?? '/');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://127.0.0.1:${port}`));

const { createServer } = require("http");
const { createReadStream, existsSync, statSync } = require("fs");
const { extname, join, normalize } = require("path");

const root = process.cwd();
const port = Number(process.env.PORT || 8001);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml"
};

createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const candidate = normalize(join(root, pathname === "/" ? "index.html" : pathname));

  if (!candidate.startsWith(root) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found\n");
    return;
  }

  res.writeHead(200, { "content-type": types[extname(candidate)] || "application/octet-stream" });
  createReadStream(candidate).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.log(`OTE Reader -> http://localhost:${port}`);
});

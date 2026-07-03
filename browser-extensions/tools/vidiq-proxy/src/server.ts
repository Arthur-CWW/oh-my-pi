import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Mode = "proxy" | "replay" | "dummy";

const port = Number(process.env.VIDIQ_PROXY_PORT ?? 4873);
const mode = (process.env.VIDIQ_PROXY_MODE ?? "proxy") as Mode;
const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const cacheRoot = path.join(
  workspaceRoot,
  "reveng/vidiq-vision/captures/http-cache",
);

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseTarget(req: IncomingMessage) {
  const incoming = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const parts = incoming.pathname.split("/").filter(Boolean);
  const protocol = parts.shift();
  const host = parts.shift();

  if ((protocol !== "https" && protocol !== "http") || !host) {
    return null;
  }

  const targetPath = `/${parts.join("/")}`;
  const target = new URL(`${protocol}://${host}${targetPath}${incoming.search}`);
  return target;
}

function cacheKey(method: string, target: URL, body: Buffer) {
  const hash = createHash("sha256")
    .update(method)
    .update("\n")
    .update(target.toString())
    .update("\n")
    .update(body)
    .digest("hex");
  return hash;
}

async function readCached(key: string) {
  const metaPath = path.join(cacheRoot, `${key}.json`);
  const bodyPath = path.join(cacheRoot, `${key}.body`);
  const [metaRaw, body] = await Promise.all([readFile(metaPath, "utf8"), readFile(bodyPath)]);
  return { meta: JSON.parse(metaRaw) as { status: number; headers: Record<string, string> }, body };
}

async function writeCached(
  key: string,
  target: URL,
  method: string,
  status: number,
  headers: Headers,
  body: Buffer,
) {
  await mkdir(cacheRoot, { recursive: true });
  const headerRecord = Object.fromEntries(headers.entries());
  const meta = {
    cachedAt: new Date().toISOString(),
    method,
    target: target.toString(),
    status,
    headers: headerRecord,
  };
  await Promise.all([
    writeFile(path.join(cacheRoot, `${key}.json`), JSON.stringify(meta, null, 2) + "\n"),
    writeFile(path.join(cacheRoot, `${key}.body`), body),
  ]);
}

function writeResponse(
  res: ServerResponse,
  status: number,
  headers: Record<string, string> | Headers,
  body: Buffer | string,
) {
  setCors(res);
  const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers);
  for (const [name, value] of entries) {
    const lower = name.toLowerCase();
    if (["content-encoding", "content-length", "set-cookie"].includes(lower)) continue;
    res.setHeader(name, value);
  }
  res.statusCode = status;
  res.end(body);
}

const server = createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const target = parseTarget(req);
  if (!target) {
    writeResponse(
      res,
      400,
      { "content-type": "application/json" },
      JSON.stringify({ error: "Expected /https/<host>/<path> or /http/<host>/<path>" }),
    );
    return;
  }

  const requestBody = await readBody(req);
  const method = req.method ?? "GET";
  const key = cacheKey(method, target, requestBody);

  try {
    const cached = await readCached(key);
    writeResponse(res, cached.meta.status, cached.meta.headers, cached.body);
    return;
  } catch {
    if (mode === "replay") {
      writeResponse(
        res,
        404,
        { "content-type": "application/json" },
        JSON.stringify({ error: "No cached response", key, target: target.toString() }),
      );
      return;
    }
  }

  if (mode === "dummy") {
    writeResponse(res, 200, { "content-type": "application/json" }, "{}");
    return;
  }

  const upstream = await fetch(target, {
    method,
    headers: {
      "accept": req.headers.accept ?? "*/*",
      "content-type": req.headers["content-type"] ?? "application/json",
    },
    body: method === "GET" || method === "HEAD" ? undefined : requestBody,
  });
  const body = Buffer.from(await upstream.arrayBuffer());
  await writeCached(key, target, method, upstream.status, upstream.headers, body);
  writeResponse(res, upstream.status, upstream.headers, body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`vidIQ replay proxy listening on http://127.0.0.1:${port}`);
  console.log(`mode=${mode} cache=${cacheRoot}`);
});

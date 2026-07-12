import { appendFile, mkdir } from "node:fs/promises";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "../dist");
const dataDir = path.resolve(import.meta.dir, "../../../data/omp-hub");
const errorLog = path.join(dataDir, "errors.log");
await mkdir(dataDir, { recursive: true });
await Bun.write(errorLog, "");
const port = Number.parseInt(process.env.PORT ?? "1355", 10);
const server = Bun.serve({
	port,
	async fetch(request) {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/healthz")
			return Response.json({ ok: true, service: "omp-hub" });
		if (request.method === "POST" && url.pathname === "/errors") {
			const body = (await request.text()).slice(0, 16_384).replaceAll("\0", "");
			await appendFile(errorLog, `${new Date().toISOString()} browser ${body}\n`);
			return new Response(null, { status: 204 });
		}
		const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
		const resolved = path.resolve(root, relative);
		if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== path.join(root, "index.html"))
			return new Response("Not found", { status: 404 });
		const file = Bun.file(resolved);
		if (await file.exists()) return new Response(file);
		return new Response(Bun.file(path.join(root, "index.html")));
	},
	error(error) {
		void appendFile(errorLog, `${new Date().toISOString()} backend ${error.stack ?? error.message}\n`);
		return new Response("Internal server error", { status: 500 });
	},
});
console.log(`omp-hub listening on ${server.url}`);

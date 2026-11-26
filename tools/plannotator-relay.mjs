// Run inside the private network namespace. Only the owner's Unix socket is
// exposed; the upstream endpoint always stays on loopback.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const [socket, command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
let port,
	tail = "";
const policy =
	"default-src 'self' blob: data:; connect-src 'self'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'self'; object-src 'none'";
const server = http.createServer((req, res) => {
	if (!port) {
		res.writeHead(503).end();
		return;
	}
	if (
		(req.method === "GET" || req.method === "HEAD") &&
		req.url.startsWith("/")
	) {
		// The pinned viewer supplies an opaque per-document HTML asset base.
		const asset = req.url
			.split("?", 1)[0]
			.replace(
				/^\/api\/html-assets\/[a-f0-9]{16}(?=\/)/,
				"/api/html-assets/@view",
			);
		const key = createHash("sha256").update(asset).digest("hex");
		const file = path.join(path.dirname(socket), "linked-evidence", key);
		if (existsSync(file)) {
			res.writeHead(200, {
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
				"content-security-policy": "sandbox; default-src 'none'",
				"referrer-policy": "no-referrer",
			});
			if (req.method === "HEAD") res.end();
			else
				createReadStream(file)
					.on("error", () => res.destroy())
					.pipe(res);
			return;
		}
	}
	const upstream = http.request(
		{
			hostname: "127.0.0.1",
			port,
			method: req.method,
			path: req.url,
			headers: req.headers,
		},
		(response) => {
			const headers = { ...response.headers, "referrer-policy": "no-referrer" };
			headers["content-security-policy"] = [
				response.headers["content-security-policy"],
				policy,
			]
				.filter(Boolean)
				.join(", ");
			res.writeHead(response.statusCode, headers);
			response.on("error", () => res.destroy()).pipe(res);
		},
	);
	upstream.on("error", () => {
		if (!res.headersSent) res.writeHead(502);
		res.end();
	});
	res.on("close", () => upstream.destroy());
	req.pipe(upstream);
});
// Preserve loopback WebSocket upgrades for interactive sessions.
server.on("upgrade", (req, client, head) => {
	if (!port) return client.destroy();
	const upstream = net.connect(port, "127.0.0.1", () => {
		upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`);
		for (let i = 0; i < req.rawHeaders.length; i += 2)
			upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
		upstream.write("\r\n");
		upstream.write(head);
		client.pipe(upstream).pipe(client);
	});
	upstream.on("error", () => client.destroy());
	client.on("error", () => upstream.destroy());
});
server.on("error", (e) => {
	process.stderr.write(`Owner access socket unavailable: ${e.code}\n`);
	child.kill();
});
server.listen(socket, () =>
	process.stderr.write(`Owner access socket ${JSON.stringify(socket)}\n`),
);
child.stderr.on("data", (data) => {
	process.stderr.write(data);
	tail = (tail + String(data)).slice(-8192);
	const match = /http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\b/.exec(tail);
	if (match) port = Number(match[1]);
});
child.on("error", () => {
	process.exitCode = 2;
	server.close();
});
child.on("close", (code, signal) => {
	server.close();
	server.closeAllConnections();
	if (signal) process.kill(process.pid, signal);
	else process.exitCode = code;
});

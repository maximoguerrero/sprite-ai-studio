import http from "node:http";

const PORT = Number(process.env.PROXY_PORT ?? 8787);
const HOST = process.env.PROXY_HOST ?? "127.0.0.1";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const FORWARDED_HEADERS = ["authorization", "content-type", "accept"];

function previewBody(buffer, contentType) {
  if (!contentType.includes("json") && !contentType.startsWith("text/")) return `[binary ${contentType} body]`;
  const text = buffer
    .toString("utf8")
    .replace(/"(b64_json|image_base64)"\s*:\s*"[^"]{64,}"/g, '"$1":"<base64 omitted>"')
    .replace(/\s+/g, " ");
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("Request body exceeds 32 MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "authorization, content-type, accept, x-provider-target");
    res.setHeader("access-control-max-age", "600");
    res.statusCode = 204;
    res.end();
    return;
  }
  if (!req.url?.startsWith("/__provider-proxy")) {
    json(res, 404, { error: "Unknown proxy route." });
    return;
  }
  const target = req.headers["x-provider-target"];
  if (typeof target !== "string" || !/^https?:\/\//i.test(target)) {
    json(res, 400, { error: "Missing or invalid X-Provider-Target header." });
    return;
  }
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string" && FORWARDED_HEADERS.includes(key)) headers[key] = value;
  }
  let body;
  try {
    if (["POST", "PUT", "PATCH"].includes(req.method ?? "")) body = await readBody(req);
  } catch (error) {
    json(res, 413, { error: error instanceof Error ? error.message : "Request body too large." });
    return;
  }
  const startedAt = Date.now();
  console.log(`[proxy] --> ${req.method} ${target}${body?.length ? ` (${body.length} bytes)` : ""}`);
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body?.length ? body : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const responseBuffer = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get("content-type") ?? "application/json";
    console.log(
      `[proxy] <-- ${upstream.status} ${target} (${responseBuffer.length} bytes, ${contentType}, ${Date.now() - startedAt}ms)`
    );
    console.log(`[proxy]     ${previewBody(responseBuffer, contentType)}`);
    res.statusCode = upstream.status;
    res.setHeader("content-type", contentType);
    res.end(responseBuffer);
  } catch (error) {
    console.log(
      `[proxy] xxx ${req.method} ${target} failed after ${Date.now() - startedAt}ms: ${error instanceof Error ? error.message : "unknown error"}`
    );
    json(res, 502, { error: `Provider proxy failed: ${error instanceof Error ? error.message : "unknown error"}` });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Provider proxy listening on http://${HOST}:${PORT}/__provider-proxy`);
});

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function providerProxy(): Plugin {
  const handle = async (req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
    const target = req.headers["x-provider-target"];
    if (typeof target !== "string" || !/^https?:\/\//i.test(target)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing or invalid X-Provider-Target header." }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string" && ["authorization", "content-type", "accept"].includes(key)) headers[key] = value;
    }
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: ["POST", "PUT", "PATCH"].includes(req.method ?? "") && chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      res.statusCode = upstream.status;
      res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
      res.end(body);
    } catch (error) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({ error: `Provider proxy failed: ${error instanceof Error ? error.message : "unknown error"}` })
      );
    }
  };
  return {
    name: "provider-proxy",
    config(_config, env) {
      if (env.command === "serve") return { define: { __PROVIDER_PROXY__: "true" } };
    },
    configureServer(server) {
      server.middlewares.use("/__provider-proxy", handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/__provider-proxy", handle);
    },
  };
}

export default defineConfig({
  plugins: [react(), providerProxy()],
  server: { port: 4173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});

import { createServer } from "http";
import next from "next";
import httpProxy from "http-proxy";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const pipecatUrl = process.env.PIPECAT_URL || "ws://localhost:8765";

const app = next({ dev });
const handle = app.getRequestHandler();

const proxy = httpProxy.createProxyServer({ target: pipecatUrl, ws: true });

proxy.on("error", (err) => {
  console.error("WebSocket proxy error:", err.message);
});

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  // Proxy WebSocket upgrades on /ws to Pipecat server
  server.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws") {
      proxy.ws(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`> Elena client ready on http://0.0.0.0:${port}`);
    console.log(`> WebSocket proxy: /ws → ${pipecatUrl}`);
  });
});

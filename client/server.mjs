import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import next from "next";
import httpProxy from "http-proxy";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const pipecatUrl = process.env.PIPECAT_URL || "ws://localhost:8765";

const certDir = join(__dirname, "certs");
const keyPath = join(certDir, "key.pem");
const certPath = join(certDir, "cert.pem");

// Auto-generate self-signed cert if missing
if (!existsSync(keyPath) || !existsSync(certPath)) {
  console.log("> Generating self-signed TLS certificate...");
  execSync(`mkdir -p "${certDir}"`);
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
    `-days 365 -nodes -subj "/CN=elena-local"`,
    { stdio: "inherit" }
  );
}

const app = next({ dev });
const handle = app.getRequestHandler();

const proxy = httpProxy.createProxyServer({ target: pipecatUrl, ws: true });

proxy.on("error", (err) => {
  console.error("WebSocket proxy error:", err.message);
});

app.prepare().then(() => {
  const tlsOptions = {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };

  // HTTPS server (for phone mic access)
  const httpsServer = createHttpsServer(tlsOptions, (req, res) => {
    handle(req, res);
  });
  httpsServer.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws") {
      proxy.ws(req, socket, head);
    } else {
      socket.destroy();
    }
  });
  httpsServer.listen(port, "0.0.0.0", () => {
    console.log(`> Elena client ready on https://0.0.0.0:${port}`);
    console.log(`> WebSocket proxy: /ws → ${pipecatUrl}`);
    console.log(`> Open https://<your-ip>:${port} on your phone (accept the cert warning)`);
  });

  // Also serve HTTP on port+1 for localhost dev
  const httpServer = createHttpServer((req, res) => {
    handle(req, res);
  });
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws") {
      proxy.ws(req, socket, head);
    } else {
      socket.destroy();
    }
  });
  httpServer.listen(port + 1, "0.0.0.0", () => {
    console.log(`> HTTP fallback on http://localhost:${port + 1}`);
  });
});

import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { networkInterfaces } from "os";
import { connect as netConnect } from "net";
import next from "next";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const pipecatUrl = process.env.PIPECAT_URL || "ws://localhost:8765";

// Parse ws://host:port from pipecatUrl
const pipecatTarget = new URL(pipecatUrl.replace(/^ws/, "http"));
const PIPECAT_HOST = pipecatTarget.hostname;
const PIPECAT_PORT = parseInt(pipecatTarget.port) || 8765;

function getLocalIP() {
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

const certDir = join(__dirname, "certs");
const keyPath = join(certDir, "key.pem");
const certPath = join(certDir, "cert.pem");

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

// Pipecat WebSocket tunnel: raw TCP pipe to Pipecat backend.
// When either side closes or errors, destroy both immediately.
function pipecatTunnel(req, clientSocket, head) {
  const upstream = netConnect(PIPECAT_PORT, PIPECAT_HOST);

  function destroy(err) {
    if (err) console.error("> WS tunnel error:", err.message);
    if (!clientSocket.destroyed) clientSocket.destroy();
    if (!upstream.destroyed) upstream.destroy();
  }

  upstream.on("error", destroy);
  clientSocket.on("error", destroy);
  upstream.on("close", destroy);
  clientSocket.on("close", destroy);

  upstream.on("connect", () => {
    const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    upstream.write(reqLine + headers + "\r\n\r\n");
    if (head && head.length) upstream.write(head);
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });
}

let nextUpgrade = null;

// Route WebSocket upgrades: /ws → Pipecat tunnel, everything else → Next.js
function handleUpgrade(req, socket, head) {
  if (req.url === "/ws") {
    pipecatTunnel(req, socket, head);
  } else if (nextUpgrade) {
    nextUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
}

app.prepare().then(() => {
  nextUpgrade = app.getUpgradeHandler();

  const tlsOptions = {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };

  const httpsServer = createHttpsServer(tlsOptions, handle);
  httpsServer.on("upgrade", handleUpgrade);
  httpsServer.listen(port, "0.0.0.0", () => {
    const localIP = getLocalIP();
    console.log(`> Elena ready:`);
    console.log(`>   Desktop:  https://localhost:${port}`);
    console.log(`>   Phone:    https://${localIP}:${port}`);
    console.log(`> WebSocket proxy: /ws → ${pipecatUrl}`);
  });

  const httpServer = createHttpServer(handle);
  httpServer.on("upgrade", handleUpgrade);
  httpServer.listen(port + 1, "0.0.0.0", () => {
    console.log(`> HTTP fallback on http://localhost:${port + 1}`);
  });
});

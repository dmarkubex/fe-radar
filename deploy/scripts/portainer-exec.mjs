#!/usr/bin/env node
/**
 * Read/execute a command inside a FE-Radar container via the Portainer API.
 *
 * Credentials are loaded from the Codex skill env file (never printed):
 *   ~/.codex/skills/harbor-portainer-stack-deploy/.env
 *   (PORTAINER_URL / PORTAINER_USERNAME / PORTAINER_PASSWORD / PORTAINER_ENDPOINT_ID)
 *
 * Usage:
 *   node deploy/scripts/portainer-exec.mjs --match worker -- hostname
 *   node deploy/scripts/portainer-exec.mjs --match postgres -- psql -U fe_radar -d fe_radar -c "SELECT 1"
 *
 * Notes:
 * - Uses Docker exec over the Portainer proxy with a raw TLS upgrade (Tty mode,
 *   stdout/stderr merged). No extra npm deps.
 * - Exits with the in-container command's exit code.
 */
import https from "node:https";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_ENV_FILE = join(
  homedir(),
  ".codex/skills/harbor-portainer-stack-deploy/.env"
);

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

function parseArgs(argv) {
  const out = { match: "", endpoint: "", cmd: [] };
  const dashDash = argv.indexOf("--");
  if (dashDash === -1) throw new Error("missing `--` before the command");
  out.cmd = argv.slice(dashDash + 1);
  const flags = argv.slice(0, dashDash);
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--match") out.match = flags[++i] || "";
    else if (flags[i] === "--endpoint") out.endpoint = flags[++i] || "";
    else throw new Error(`unknown flag: ${flags[i]}`);
  }
  if (!out.match) throw new Error("--match <container name substring> is required");
  if (out.cmd.length === 0) throw new Error("command after `--` is empty");
  return out;
}

function requestJson(baseUrl, path, { token, method = "GET", body } = {}) {
  const url = new URL(`${baseUrl}${path}`);
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  const insecure = process.env.PORTAINER_INSECURE !== "0";
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        rejectUnauthorized: !insecure
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} ${path}: ${text.slice(0, 300)}`));
          } else {
            resolve(parsed);
          }
        });
      }
    );
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Stream exec output via Portainer's websocket relay.
 * The raw `Upgrade: tcp` hijack is NOT supported by the Portainer proxy, and Node's
 * built-in WebSocket cannot skip self-signed cert verification reliably, so the
 * handshake + frame codec is implemented here over a raw TLS socket.
 * Endpoint (singular, Portainer CE 2.x): /api/websocket/exec?id=<execId>&endpointId=<id>&token=<jwt>
 */
import tls from "node:tls";
import crypto from "node:crypto";

function wsEncodeFrame(opcode, payload) {
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function execStartWs(baseUrl, execId, endpointId, token, timeoutMs = 300_000) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const socket = tls.connect(
      {
        host: url.hostname,
        port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
        rejectUnauthorized: false
      },
      () => {
        socket.write(
          `GET /api/websocket/exec?id=${encodeURIComponent(execId)}` +
            `&endpointId=${encodeURIComponent(endpointId)}&token=${encodeURIComponent(token)} HTTP/1.1\r\n` +
            `Host: ${url.host}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Version: 13\r\n` +
            `Origin: ${baseUrl}\r\n\r\n`
        );
      }
    );
    let headerDone = false;
    let head = Buffer.alloc(0);
    let frames = Buffer.alloc(0);
    let out = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`exec stream timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    const finish = (err) => {
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(out);
    };
    socket.on("data", (chunk) => {
      if (!headerDone) {
        head = Buffer.concat([head, chunk]);
        const idx = head.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const statusLine = head.slice(0, head.indexOf("\r\n")).toString("utf8");
        if (!statusLine.includes("101")) {
          finish(new Error(`websocket handshake failed: ${statusLine}`));
          return;
        }
        headerDone = true;
        chunk = head.slice(idx + 4);
        if (chunk.length === 0) return;
      }
      frames = Buffer.concat([frames, chunk]);
      // Parse complete frames.
      let i = 0;
      while (i + 2 <= frames.length) {
        const op = frames[i] & 0x0f;
        let len = frames[i + 1] & 0x7f;
        let off = i + 2;
        if (len === 126) {
          if (i + 4 > frames.length) break;
          len = frames.readUInt16BE(i + 2);
          off = i + 4;
        } else if (len === 127) {
          if (i + 10 > frames.length) break;
          len = Number(frames.readBigUInt64BE(i + 2));
          off = i + 10;
        }
        if (off + len > frames.length) break;
        const payload = frames.slice(off, off + len);
        if (op === 0x8) {
          finish();
          return;
        }
        if (op === 0x9) {
          socket.write(wsEncodeFrame(0x0a, payload));
        } else if (op === 0x1 || op === 0x2 || op === 0x0) {
          out += payload.toString("utf8");
        }
        i = off + len;
      }
      frames = frames.slice(i);
    });
    socket.on("error", (err) => finish(err));
    socket.on("close", () => finish());
  });
}

async function main() {
  loadEnvFile(process.env.PORTAINER_ENV_FILE || DEFAULT_ENV_FILE);
  const args = parseArgs(process.argv.slice(2));

  const baseUrl = (process.env.PORTAINER_URL || "").replace(/\/+$/, "");
  const username = process.env.PORTAINER_USERNAME || "admin";
  const password = process.env.PORTAINER_PASSWORD;
  if (!baseUrl || !password) {
    throw new Error("PORTAINER_URL / PORTAINER_PASSWORD missing (check env file)");
  }
  const endpoint = args.endpoint || process.env.PORTAINER_ENDPOINT_ID || "3";

  const auth = await requestJson(baseUrl, "/api/auth", {
    method: "POST",
    body: { username, password }
  });
  const token = auth.jwt;

  const containers = await requestJson(
    baseUrl,
    `/api/endpoints/${endpoint}/docker/containers/json?all=0`,
    { token }
  );
  const needle = args.match.toLowerCase();
  const matches = containers.filter((c) =>
    (c.Names || []).some((n) => n.toLowerCase().includes(needle))
  );
  if (matches.length === 0) {
    throw new Error(
      `no running container matches "${args.match}". Running: ${containers
        .map((c) => c.Names?.[0])
        .join(", ")}`
    );
  }
  const target = matches[0];
  if (matches.length > 1) {
    console.error(
      `warn: ${matches.length} containers match, using ${target.Names?.[0]}`
    );
  }

  const exec = await requestJson(
    baseUrl,
    `/api/endpoints/${endpoint}/docker/containers/${target.Id}/exec`,
    {
      token,
      method: "POST",
      body: {
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: args.cmd
      }
    }
  );

  const output = await execStartWs(baseUrl, exec.Id, endpoint, token);
  // Tty stream may contain \r\n; normalize for display.
  process.stdout.write(output.replace(/\r\n/g, "\n"));

  const inspect = await requestJson(
    baseUrl,
    `/api/endpoints/${endpoint}/docker/exec/${exec.Id}/json`,
    { token }
  );
  process.exit(inspect.ExitCode ?? 1);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(2);
});

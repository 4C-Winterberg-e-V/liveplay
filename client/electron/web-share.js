// LivePlay — In-App Web-Sharing (LAN + Cloudflare-Tunnel)
// ---------------------------------------------------------------------------
// AGPL-3.0-only
//
// Lets the desktop app expose its bundled web UI to phones/tablets WITHOUT
// any extra software on the operator's machine (no Docker, no nginx, no
// WireGuard). Everything below ships inside LivePlay.app.
//
// Architecture (Same-Origin proxy, identical to the documented "Modus A",
// but realised in-process instead of via a separate reverse proxy):
//
//   phone ──http(s)──> this server (0.0.0.0:webPort)
//                        ├─ static SPA            (/)      ← .output/public
//                        └─ /api/* + /ws  ──proxy──> 127.0.0.1:<serverPort>
//                                                   (the bundled C++ server)
//
//   - LAN:    phone opens http://<mac-ip>:<webPort> on the same network.
//   - Tunnel: cloudflared (bundled) opens https://<rand>.trycloudflare.com,
//             a free quick-tunnel — no Cloudflare account, no domain, no DNS.
//
// Because the SPA and the API share ONE origin, there is no Mixed-Content and
// no CORS dependency, and the client auto-detects the server via
// window.location.origin — no manual address entry on the phone.
//
// Security: the C++ server has no auth and exposes filesystem access. LAN
// sharing assumes a trusted network. Tunnel sharing is internet-facing, so we
// switch on a BasicAuth gate (random credentials) for the WHOLE shared site
// the moment a tunnel is up — covers both the HTTP API and the WebSocket
// handshake (same origin).
// ---------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const express = require('express');
const httpProxy = require('http-proxy');
const QRCode = require('qrcode');

const DEFAULT_WEB_PORT = 8088;

// trycloudflare URLs look like https://<words>.trycloudflare.com — cloudflared
// prints the assigned URL to stderr once the quick tunnel is established.
const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

class WebShare extends EventEmitter {
  constructor() {
    super();
    this.staticRoot = null;     // absolute path to .output/public (set by main)
    this.serverPort = 4480;     // C++ control server port to proxy to
    this.devServerUrl = null;   // when set (dev mode), proxy the UI to nuxt dev

    this.httpServer = null;     // node http.Server hosting the SPA + proxy
    this.proxy = null;          // http-proxy instance
    this.webPort = null;        // bound LAN port once running
    this.lanUrls = [];          // http://<each-lan-ip>:<webPort>

    this.tunnelProc = null;     // cloudflared ChildProcess
    this.tunnelUrl = null;      // https://...trycloudflare.com once ready
    this.tunnelStarting = false;
    this.tunnelError = null;        // last tunnel failure message (shown in UI)
    this.lastTunnelStderr = '';     // last stderr line from cloudflared

    this.auth = null;           // { user, pass } when the auth gate is armed
    this.sessionToken = null;   // cookie token issued after a successful login
    this.pin = null;            // stable PIN for this app process — generated
                                // once, reused across tunnel restarts; a fresh
                                // app launch (new process) gets a new one.
    this.authEnabled = true;    // when false the BasicAuth gate stays OFF even
                                // while a tunnel is up — the shared site is then
                                // PUBLIC. Opt-out only; default on for safety.
    this.customPin = null;      // operator-chosen PIN; when set it's used as the
                                // auth password instead of a random one (and it
                                // persists across app launches). null ⇒ random.

    this.namedTunnel = null;    // optional per-machine config for a STABLE URL
                                // (operator's own Cloudflare account). When set,
                                // startTunnel runs a named tunnel whose
                                // https://<hostname> stays identical across
                                // restarts/reboots; when null we fall back to
                                // the free random quick tunnel.
    this._tunnelTmpConfig = null; // path of the throwaway cloudflared ingress
                                  // config (credentials-file mode only).
  }

  /** Wire up paths/ports before first use. Safe to call repeatedly. */
  configure({ staticRoot, serverPort, devServerUrl, namedTunnel, authEnabled, pin }) {
    if (staticRoot) this.staticRoot = staticRoot;
    if (Number.isInteger(serverPort)) this.serverPort = serverPort;
    if (devServerUrl !== undefined) this.devServerUrl = devServerUrl;
    if (namedTunnel !== undefined) this.namedTunnel = normaliseNamedTunnel(namedTunnel);
    if (authEnabled !== undefined) this.authEnabled = !!authEnabled;
    if (pin !== undefined) this.customPin = (typeof pin === 'string' && pin.trim()) ? pin.trim() : null;
  }

  // ── status ────────────────────────────────────────────────────────────
  isHosting() { return !!this.httpServer; }
  isTunnelUp() { return !!this.tunnelUrl; }

  async status() {
    const lanQr = this.lanUrls[0] ? await safeQr(this.lanUrls[0]) : null;
    const tunnelQr = this.tunnelUrl ? await safeQr(this.tunnelLinkWithAuth()) : null;
    return {
      hosting: this.isHosting(),
      webPort: this.webPort,
      lanUrls: this.lanUrls,
      lanQr,
      tunnel: this.tunnelStarting ? 'starting' : (this.tunnelUrl ? 'up' : 'down'),
      tunnelUrl: this.tunnelUrl,
      tunnelQr,
      tunnelError: this.tunnelError,
      // true ⇒ a named tunnel is configured, so the URL stays the same on this
      // machine across restarts (vs. the random quick-tunnel URL).
      tunnelStable: !!this.namedTunnel,
      tunnelHostname: this.namedTunnel ? this.namedTunnel.hostname : null,
      authEnabled: this.authEnabled,
      customPin: this.customPin || '',   // '' ⇒ a random PIN is used
      auth: this.auth ? { user: this.auth.user, pass: this.auth.pass } : null,
    };
  }

  emitStatus() {
    // Fire-and-forget; main forwards this to the renderer.
    this.status().then((s) => this.emit('status', s)).catch(() => {});
  }

  // ── LAN hosting ─────────────────────────────────────────────────────────
  async startLan(webPort = DEFAULT_WEB_PORT) {
    if (this.httpServer) return this.status();
    // In dev we serve the UI from the running nuxt dev server; otherwise from
    // the bundled static build. One of the two must be available.
    const hasStatic = this.staticRoot && fs.existsSync(path.join(this.staticRoot, 'index.html'));
    if (!this.devServerUrl && !hasStatic) {
      throw new Error(`web UI not found at ${this.staticRoot} — run "npm run generate" first, or start in dev mode`);
    }

    this.proxy = httpProxy.createProxyServer({
      target: `http://127.0.0.1:${this.serverPort}`,
      ws: true,
      changeOrigin: false,
    });
    // A dead/restarting C++ server must not crash the host process.
    this.proxy.on('error', (err, _req, res) => {
      try {
        if (res && res.writeHead && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'liveplay-server unreachable' }));
        } else if (res && res.destroy) {
          res.destroy();
        }
      } catch { /* socket already gone */ }
    });

    const app = express();

    // Auth gate — only enforced once a tunnel is up (internet-facing). On the
    // trusted LAN the QR stays frictionless.
    app.use((req, res, next) => this._authGate(req, res, next));

    // Proxy the control surface to the C++ server. Mounted WITHOUT a path
    // prefix so req.url keeps the leading "/api" (Express would otherwise strip
    // it and http-proxy would hit the wrong target).
    app.use((req, res, next) => {
      if (req.url === '/api' || req.url.startsWith('/api/')) {
        return this.proxy.web(req, res);
      }
      next();
    });
    if (this.devServerUrl) {
      // Dev: hand every non-API request to the nuxt dev server (HMR included).
      app.use((req, res) => this.proxy.web(req, res, { target: this.devServerUrl }));
    } else {
      // Production: static SPA + history fallback (single index.html, ssr:false).
      app.use(express.static(this.staticRoot, { index: 'index.html', fallthrough: true }));
      app.use((req, res) => {
        res.sendFile(path.join(this.staticRoot, 'index.html'));
      });
    }

    const server = http.createServer(app);

    // WebSocket upgrade (/ws) → C++ server. Auth is checked here too, so the
    // meter/transport socket is gated identically to the HTTP API.
    server.on('upgrade', (req, socket, head) => {
      if (!req.url) { socket.destroy(); return; }
      if (!this._authOkUpgrade(req)) {
        // Deliberately NO WWW-Authenticate header: a 401 carrying it on a WS
        // handshake makes browsers pop the BasicAuth dialog, and the auto-
        // reconnecting socket would re-trigger it forever. The authenticated
        // page load sets the session cookie that lets this through normally.
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      if (req.url.startsWith('/ws')) {
        // Control/meter socket → C++ server (default proxy target).
        this.proxy.ws(req, socket, head);
      } else if (this.devServerUrl) {
        // Vite/nuxt HMR socket → dev server.
        this.proxy.ws(req, socket, head, { target: this.devServerUrl });
      } else {
        socket.destroy();
      }
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(webPort, '0.0.0.0', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    this.httpServer = server;
    this.webPort = webPort;
    this.lanUrls = lanIpv4().map((ip) => `http://${ip}:${webPort}`);
    this.emitStatus();
    return this.status();
  }

  async stopLan() {
    await this.stopTunnel();
    if (this.proxy) { try { this.proxy.close(); } catch {} this.proxy = null; }
    if (this.httpServer) {
      await new Promise((r) => this.httpServer.close(r));
      this.httpServer = null;
    }
    this.webPort = null;
    this.lanUrls = [];
    this.auth = null;
    this.sessionToken = null;
    this.emitStatus();
    return this.status();
  }

  // ── Cloudflare tunnel ─────────────────────────────────────────────────────
  // Two flavours, picked automatically by whether a named-tunnel config is set:
  //   • Named tunnel (this.namedTunnel) → a STABLE https://<hostname> that stays
  //     identical across restarts/reboots, on the operator's own Cloudflare
  //     account (set up once per machine, via token or credentials file).
  //   • Quick tunnel (no config) → the free random https://<rand>.trycloudflare
  //     .com whose URL changes on every start.
  async startTunnel(webPort = DEFAULT_WEB_PORT) {
    if (this.tunnelUrl || this.tunnelStarting) return this.status();

    const named = this.namedTunnel;
    // A token (remotely-managed) tunnel has its ingress pinned in the Cloudflare
    // dashboard to a fixed local port — host the web UI on exactly that port so
    // the dashboard's `service: http://localhost:<port>` resolves.
    const effectivePort = (named && named.mode === 'token' && named.port) ? named.port : webPort;
    if (!this.httpServer) await this.startLan(effectivePort);

    const bin = resolveCloudflared();
    if (!bin) {
      throw new Error('cloudflared binary not found (bundle it under resources/bin or add the "cloudflared" npm dep)');
    }

    // NOTE: the auth gate is armed only once the tunnel is actually UP — see
    // _onTunnelUp. Arming it earlier would lock the LAN while the tunnel is
    // still "starting" (or after it fails) WITHOUT showing the PIN, since the
    // PIN is only displayed for an up tunnel.
    this.tunnelStarting = true;
    this.tunnelError = null;
    this.lastTunnelStderr = '';
    this.emitStatus();

    try {
      return named ? this._startNamedTunnel(bin, named) : this._startQuickTunnel(bin);
    } catch (e) {
      // Synchronous failure before the process was wired up (e.g. couldn't
      // write the temp ingress config) — don't leave the UI stuck on "starting".
      this.tunnelStarting = false;
      this.tunnelError = String((e && e.message) || e);
      this._cleanupTunnelTmp();
      this.emitStatus();
      throw e;
    }
  }

  // Free quick tunnel: cloudflared prints the assigned random URL to stderr.
  _startQuickTunnel(bin) {
    const args = [
      'tunnel', '--no-autoupdate',
      '--url', `http://127.0.0.1:${this.webPort}`,
    ];
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.tunnelProc = proc;

    const onData = (buf) => {
      const text = buf.toString();
      // Keep the last meaningful line so a failure can be reported in the UI.
      const line = text.split('\n').map(s => s.trim()).filter(Boolean).pop();
      if (line) this.lastTunnelStderr = line;
      const m = text.match(TUNNEL_URL_RE);
      if (m && !this.tunnelUrl) this._onTunnelUp(m[0]);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => this._onTunnelExit(code));
    proc.on('error', (err) => this._onTunnelSpawnError(err));
    return this.status();
  }

  // Stable named tunnel on the operator's own Cloudflare account. The public URL
  // is known up-front (https://<hostname>); we surface it once cloudflared
  // reports at least one registered edge connection (= the hostname now routes).
  _startNamedTunnel(bin, named) {
    const publicUrl = `https://${named.hostname}`;
    let args;
    if (named.mode === 'token') {
      // Remotely-managed: the connector token carries the tunnel identity +
      // secret; the hostname→service ingress lives in the Cloudflare dashboard.
      args = ['tunnel', '--no-autoupdate', 'run', '--token', named.token];
    } else {
      // Locally-managed: generate an ingress config so the (possibly dynamic)
      // web port is routed to the configured hostname.
      this._tunnelTmpConfig = this._writeNamedTunnelConfig(named);
      args = ['tunnel', '--no-autoupdate', '--config', this._tunnelTmpConfig, 'run', named.tunnelId || named.tunnelName];
    }

    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.tunnelProc = proc;

    // cloudflared logs e.g. "INF Registered tunnel connection connIndex=0 …"
    // once an edge connection is live — that's when the hostname starts routing.
    const READY_RE = /Registered tunnel connection|Connection .+ registered/i;
    const onData = (buf) => {
      const text = buf.toString();
      const line = text.split('\n').map(s => s.trim()).filter(Boolean).pop();
      if (line) this.lastTunnelStderr = line;
      if (!this.tunnelUrl && READY_RE.test(text)) this._onTunnelUp(publicUrl);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => this._onTunnelExit(code));
    proc.on('error', (err) => this._onTunnelSpawnError(err));
    return this.status();
  }

  // Tunnel reached the "up" state → record the URL and (unless the operator
  // opted out) arm the auth gate. The PIN is per app process (stable across
  // tunnel restarts); the session cookie authenticates the WebSocket handshake.
  _onTunnelUp(url) {
    this.tunnelUrl = url;
    this.tunnelStarting = false;
    if (this.authEnabled) this._armAuth();
    this.emit('log', `[web-share] tunnel up: ${this.tunnelUrl}${this.auth ? '' : ' (no auth)'}`);
    this.emitStatus();
  }

  _armAuth() {
    // An operator-chosen PIN wins; otherwise reuse this process's random PIN
    // (generated once) or mint a fresh one.
    if (this.customPin) this.pin = this.customPin;
    else if (!this.pin) this.pin = makePin(4);
    this.auth = { user: 'liveplay', pass: this.pin };
    this.sessionToken = crypto.randomBytes(18).toString('base64url');
  }

  // Set (or clear) the operator-chosen PIN. Empty ⇒ back to a random PIN. When a
  // tunnel is already up with auth armed, re-arm so the new PIN takes effect at
  // once (existing logged-in devices are dropped — the password changed).
  setPin(pin) {
    const clean = String(pin || '').trim();
    this.customPin = clean || null;
    this.pin = this.customPin;   // null ⇒ a fresh random PIN on the next arm
    if (this.tunnelUrl && this.authEnabled) this._armAuth();
    this.emitStatus();
    return this.status();
  }

  // Toggle the BasicAuth gate. When a tunnel is already up we (dis)arm it on the
  // fly so the change takes effect without restarting the tunnel. Turning it OFF
  // makes the shared site PUBLIC — anyone with the URL can control the server.
  setAuthEnabled(enabled) {
    this.authEnabled = !!enabled;
    if (this.tunnelUrl) {
      if (this.authEnabled && !this.auth) this._armAuth();
      else if (!this.authEnabled && this.auth) { this.auth = null; this.sessionToken = null; }
    }
    this.emitStatus();
    return this.status();
  }

  _onTunnelExit(code) {
    this.emit('log', `[web-share] cloudflared exited (${code})`);
    // A non-zero exit before a URL arrived ⇒ surface the last stderr line.
    if (!this.tunnelUrl && code) {
      this.tunnelError = this.lastTunnelStderr || `cloudflared exited (${code})`;
    }
    this._cleanupTunnelTmp();
    this.tunnelProc = null;
    this.tunnelUrl = null;
    this.tunnelStarting = false;
    this.auth = null;
    this.sessionToken = null;
    this.emitStatus();
  }

  _onTunnelSpawnError(err) {
    this.emit('log', `[web-share] cloudflared spawn error: ${err.message}`);
    this.tunnelError = `cloudflared konnte nicht gestartet werden: ${err.message}`;
    this._cleanupTunnelTmp();
    this.tunnelProc = null;
    this.tunnelStarting = false;
    this.auth = null;
    this.sessionToken = null;
    this.emitStatus();
  }

  async stopTunnel() {
    const proc = this.tunnelProc;
    this.tunnelProc = null;
    this.tunnelUrl = null;
    this.tunnelStarting = false;
    this.auth = null;
    this.sessionToken = null;
    if (proc) {
      try { proc.kill('SIGTERM'); } catch {}
    }
    this._cleanupTunnelTmp();
    this.emitStatus();
  }

  // Write a throwaway cloudflared ingress config for credentials-file mode. It
  // lives in the OS temp dir and is removed when the tunnel stops. JSON.stringify
  // double-quotes the values — valid YAML scalars, so paths with spaces survive.
  _writeNamedTunnelConfig(named) {
    const p = path.join(os.tmpdir(), `liveplay-cloudflared-${process.pid}.yml`);
    const yml = [
      `tunnel: ${JSON.stringify(named.tunnelId || named.tunnelName)}`,
      `credentials-file: ${JSON.stringify(named.credentialsFile)}`,
      `ingress:`,
      `  - hostname: ${JSON.stringify(named.hostname)}`,
      `    service: http://127.0.0.1:${this.webPort}`,
      `  - service: http_status:404`,
      ``,
    ].join('\n');
    fs.writeFileSync(p, yml);
    return p;
  }

  _cleanupTunnelTmp() {
    if (this._tunnelTmpConfig) {
      try { fs.unlinkSync(this._tunnelTmpConfig); } catch {}
      this._tunnelTmpConfig = null;
    }
  }

  // The tunnel QR embeds the BasicAuth credentials so the first load on the
  // phone authenticates automatically; Safari then re-sends them (incl. on the
  // same-origin WebSocket handshake), per the documented PWA behaviour.
  tunnelLinkWithAuth() {
    if (!this.tunnelUrl) return null;
    if (!this.auth) return this.tunnelUrl;
    return this.tunnelUrl.replace('https://', `https://${encodeURIComponent(this.auth.user)}:${encodeURIComponent(this.auth.pass)}@`);
  }

  // ── auth helpers ──────────────────────────────────────────────────────────
  _authGate(req, res, next) {
    if (!this.auth) return next();
    if (this._authOk(req.headers['authorization'])) {
      // Issue a session cookie on the authenticated page load. Browsers send
      // cookies on the WebSocket handshake (but not reliably BasicAuth), so the
      // cookie is what lets /ws and the HMR socket through without a re-prompt.
      // No Secure flag: while a tunnel is up, LAN clients still reach this same
      // server over plain http on :<port> and must be able to store the cookie.
      if (!this._cookieOk(req)) {
        res.set('Set-Cookie', `lp_auth=${this.sessionToken}; Path=/; HttpOnly; SameSite=Lax`);
      }
      return next();
    }
    if (this._cookieOk(req)) return next();
    res.set('WWW-Authenticate', 'Basic realm="LivePlay"');
    res.status(401).send('Authentication required');
  }
  _authOkUpgrade(req) {
    if (!this.auth) return true;
    // Prefer the cookie (reliably sent on WS handshakes); fall back to BasicAuth.
    return this._cookieOk(req) || this._authOk(req.headers['authorization']);
  }
  _cookieToken(req) {
    const raw = req.headers['cookie'];
    if (!raw) return null;
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === 'lp_auth') return part.slice(eq + 1).trim();
    }
    return null;
  }
  _cookieOk(req) {
    const t = this._cookieToken(req);
    return !!(this.sessionToken && t && safeEqual(t, this.sessionToken));
  }
  _authOk(header) {
    if (!this.auth) return true;
    if (!header || !header.startsWith('Basic ')) return false;
    let decoded = '';
    try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8'); } catch { return false; }
    const idx = decoded.indexOf(':');
    if (idx < 0) return false;
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    // Constant-time-ish compare.
    return safeEqual(user, this.auth.user) && safeEqual(pass, this.auth.pass);
  }
}

// ── module-scope helpers ────────────────────────────────────────────────────

function lanIpv4() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out.length ? out : ['127.0.0.1'];
}

// Validate/normalise the per-machine named-tunnel config. Returns a clean
// object or null (→ fall back to the random quick tunnel). A hostname is always
// required; then EITHER a connector `token` (remotely-managed, ingress in the
// dashboard) OR a `credentialsFile` + tunnel id/name (locally-managed).
function normaliseNamedTunnel(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const hostname = typeof cfg.hostname === 'string'
    ? cfg.hostname.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    : '';
  if (!hostname) return null;

  const token = typeof cfg.token === 'string' ? cfg.token.trim() : '';
  if (token) {
    const port = Number.isInteger(cfg.port) ? cfg.port : DEFAULT_WEB_PORT;
    return { mode: 'token', hostname, token, port };
  }

  const credentialsFile = typeof cfg.credentialsFile === 'string' ? cfg.credentialsFile.trim() : '';
  const tunnelId   = typeof cfg.tunnelId === 'string'   ? cfg.tunnelId.trim()   : '';
  const tunnelName = typeof cfg.tunnelName === 'string' ? cfg.tunnelName.trim() : '';
  if (credentialsFile && (tunnelId || tunnelName)) {
    return { mode: 'creds', hostname, credentialsFile, tunnelId, tunnelName };
  }
  return null;
}

function resolveCloudflared() {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  // 1) Bundled next to the app (electron-builder extraResources → bin/).
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', exe));
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // 2) Fallback: the "cloudflared" npm package downloads a per-platform binary.
  try {
    // eslint-disable-next-line global-require
    const cf = require('cloudflared');
    if (cf && cf.bin) {
      // In a packaged app `cf.bin` points INTO app.asar (a file), so spawning it
      // fails with ENOTDIR. The binary is asarUnpack'd to app.asar.unpacked —
      // rewrite the path so we spawn the real, executable file.
      const unpacked = cf.bin.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      if (unpacked !== cf.bin && fs.existsSync(unpacked)) return unpacked;
      if (fs.existsSync(cf.bin)) return cf.bin;
    }
  } catch { /* package not installed */ }
  return null;
}

// Numeric PIN — fastest to type on a phone (numeric keypad). crypto.randomInt
// is uniform (no modulo bias); leading zeros are kept since it's a string.
// NB: 4 digits ≈ 13 bits — only ~10k combinations, trivially brute-forceable
// without rate limiting. Acceptable only because the tunnel hostname is
// random/ephemeral; stop the tunnel after use (consider a lockout if exposed).
function makePin(len = 4) {
  let out = '';
  for (let i = 0; i < len; i++) out += String(crypto.randomInt(10));
  return out;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function safeQr(text) {
  try { return await QRCode.toDataURL(text, { margin: 1, width: 320 }); }
  catch { return null; }
}

module.exports = { WebShare, DEFAULT_WEB_PORT };

# LivePlay

![LivePlay main interface — playlist editor, cart grid and properties panel](client/public/screenshots/liveplay_screenshot.jpg)

**LivePlay** is a free, open-source audio playback system for live sound operators who need reliable, flexible cue management. It is built around a **decoupled client/server architecture**: a headless C++ audio engine handles all sound, while a cross-platform Electron desktop app drives it as a remote control.

> ### 🔱 This is the 4C-Winterberg fork
>
> This repository is a community fork of the upstream project
> **[`tdoukinitsas/liveplay`](https://github.com/tdoukinitsas/liveplay)**,
> maintained by **[4C-Winterberg e.V.](https://github.com/4C-Winterberg-e-V)**
> The headless C++ engine, the desktop UI and the core cue/routing model come
> straight from upstream and carry all the credit. What this fork adds — a real
> **browser client**, **one-click Web-Sharing to phones and tablets**, a
> **mobile-first responsive UI**, **authentication for remote access**, and a
> **filesystem-sandboxed server** — is
> summarised in **[What this fork adds](#-what-this-fork-adds-vs-upstream)**.
> Everything is AGPL-3.0 and intended to flow back upstream where it fits.

Made with some help from Claude Sonnet 4.5, Claude Sonnet 4.6 and Claude Opus 4.8

- 📱 **Operate from any phone or tablet browser** — one **Share** button, LAN or a built-in Cloudflare tunnel, QR code, no app to install *(fork)*
- 🔐 **Authenticated remote access** — per-session PIN / BasicAuth gate, stable session for the WebSocket, optional fixed tunnel URL per machine *(fork)*
- 🎚 Multi-device output routing (FOH + monitors + comms + record bus, all at once)
- 🎬 Per-cue SMPTE LTC generator
- 🔊 Brick-wall master limiter on every output
- 📊 Three-stage real-time metering (per-cue, mixer-channel, master)
- 🌐 REST + WebSocket control surface — run the server on a stage-side machine and operate it remotely
- 🛡 **Filesystem-sandboxed server** — the API can no longer wander the whole disk *(fork)*
- 🌍 Localised in **20 languages** with full RTL support
- 📦 Native installers for **Windows, macOS (Intel + Apple Silicon) and Linux**

---

## Table of contents

- [What this fork adds (vs upstream)](#-what-this-fork-adds-vs-upstream)
- [What LivePlay does](#what-liveplay-does)
- [Operating LivePlay from a phone or tablet](#operating-liveplay-from-a-phone-or-tablet)
- [Hosting the web client (LAN, tunnel)](#hosting-the-web-client-lan-tunnel)
- [Installing and using LivePlay](#installing-and-using-liveplay)
- [Repository layout](#repository-layout)
- [Building from source](#building-from-source)
- [Development workflow](#development-workflow)
- [Releases & GitHub Actions](#releases--github-actions)
- [Relationship to upstream](#relationship-to-upstream)
- [Contributing](#contributing)
- [License](#license)

---

## 🔱 What this fork adds (vs upstream)

Upstream LivePlay is a **desktop-only** application: the Nuxt UI runs only inside
Electron, and the only remote-control surface is the raw, unauthenticated
REST/WebSocket API. This fork turns that into something you can put on a phone at
a venue, safely.

| Area | Upstream (`tdoukinitsas/liveplay`) | This fork (`4C-Winterberg-e-V/liveplay`) |
|------|------------------------------------|------------------------------------------|
| **Web client** | UI only runs inside Electron | UI also builds and runs as a plain **browser app** (`BUILD_TARGET=web`), with smart server-address detection, CORS-safe requests, and graceful degradation when no Electron APIs exist |
| **Sharing to mobile** | — | One-click **Share** in the app header: serve the UI on the **LAN** or via a bundled **Cloudflare quick-tunnel**, with QR code |
| **Mobile UX** | Desktop layout only | Full **responsive pass**: collapsible playlist & cart, full-screen Properties panel, touch-optimised cart slots, transport in the title bar, iOS safe-area / PWA support |
| **Authentication** | None on the API | Per-session **PIN / BasicAuth gate**, stable session cookie so the WebSocket survives login, **toggleable** auth, **manually settable PIN**, and an **optional fixed tunnel URL** (Named Tunnel) per machine |
| **Remote hosting** | — | Web client also builds as a **standalone SPA** that you can serve behind your own same-origin reverse proxy (Caddy / nginx / Traefik) with a BasicAuth gate |
| **Server security** | API can read/write arbitrary paths | Server filesystem access is **confined to a sandbox**; file dialogs no longer open at `/` |
| **Tooling** | npm | Migrated to **pnpm** workspaces; CI on **Node 22 LTS**; server auto-rebuilds when its C++ sources change; optional **software rendering** for headless/VM Linux; Electron Edit menu (copy/paste) |

The headings below ([Operating from mobile](#operating-liveplay-from-a-phone-or-tablet)
and [Hosting the web client](#hosting-the-web-client-lan-tunnel)) document the
fork-specific features in detail. The rest of the README covers LivePlay as a
whole.

> ⚠️ **Security in one line:** the underlying C++ server has **no built-in auth**
> and its API exposes filesystem access. The fork's PIN/BasicAuth gate exists to
> put a lock in front of it — but only use LAN sharing
> on a trusted network, keep the login private, and **stop the tunnel after the
> event**.

---

## What LivePlay does

LivePlay is a cue-playback application aimed at theatre, conferences, AV installs, and live performance. The operator builds a **project** (a `.liveplay` file plus a folder of media) containing:

- **A playlist** of audio cues organised into nested groups, with per-cue volume, in/out trim, fade times, ducking behaviour, and start/end behaviours (play next, loop, jump to cue, …).
- **A cart grid** of one-touch buttons mapped to cues for stings, SFX and walk-ons.
- **A routing matrix** that maps cue source channels → mixer channels → master outputs → physical hardware outputs across one or more sound cards.

At showtime, the operator triggers cues via the UI, the cart grid, configured keyboard shortcuts, MIDI controllers, or HTTP/WebSocket calls from external automation. Each cue plays through its own decoder, runs through a three-tier mixer, and lands on a brick-wall limiter before hitting the DAC.

### Architecture in one diagram

```
+--------------------------------+   WebSocket (ws://host:4480/ws)   +-----------------------------------+
|  client/                       | <----- meters @ ~60 Hz ---------> |  server/  (liveplay-server)       |
|  Electron + Nuxt 4 + Vue 3     | <----- transport / route cmds --- |  C++20, miniaudio, Crow, TagLib   |
|  (also builds as a web app —   |        REST  (http://host:4480)   |                                   |
|   see "What this fork adds")   | <----- list / load / waveform --> |  - AudioEngine (mixer + limiter)  |
|                                |                                   |  - ProjectState (.liveplay I/O)   |
|  - Playlist / cart / routing UI|                                   |  - ControlServer (REST + WS)      |
|  - WaveformCanvas              |                                   |  - Metadata + waveform services   |
|  - LiveMeterBar                |                                   |  - Sandboxed filesystem access    |
|                                |                                   |                                   |
|  No audio plays in the         |                                   |  Win → WASAPI · Mac → CoreAudio   |
|  renderer process.             |                                   |  Linux → ALSA / PulseAudio        |
+--------------------------------+                                   +-----------------------------------+
        ▲  (this fork)
        │ same-origin reverse proxy + auth gate
        │
+-------┴------------------------+
|  Phone / tablet browser        |   Share → LAN (http://host:8088) or Cloudflare tunnel (https://…)
|  Mobile-responsive UI          |
+--------------------------------+
```

Client and server can run on **the same machine** (the desktop installer bundles both) or on **different machines** on a LAN — e.g. the show laptop driving a stage-side mini-PC that's wired to the actual sound interfaces. With this fork, a **phone or tablet** can join as a third surface through the in-app Share feature.

For the deep architectural docs (mixer tiers, routing matrix, LTC, limiter, metering, network event lifecycle, project-file backwards compatibility), see [`server/README.md`](server/README.md).

---

## Operating LivePlay from a phone or tablet

*(This is a fork feature — it is not in upstream LivePlay.)*

You can operate LivePlay from a phone or tablet browser **without installing
anything besides LivePlay** on the host machine. In the desktop app, open the
header **Share** button and choose:

- **Local network** — serves the UI on the LAN (`http://<host-ip>:8088`). Scan
  the shown QR code from a device on the same Wi-Fi.
- **Cloudflare tunnel** — starts a bundled `cloudflared` quick-tunnel and gives
  you a public `https://…trycloudflare.com` address (no Cloudflare account,
  domain or DNS).

The host app runs a **same-origin reverse proxy** in front of the bundled C++
server, so there's no Mixed-Content or CORS setup and the phone auto-detects the
server.

### Authentication

Because the underlying API has no auth of its own, this fork puts a gate in front
of any shared session:

- **Per-session PIN / BasicAuth** — shown in the Share dialog. The PIN is kept
  stable for the app session, and a session cookie keeps the WebSocket connected
  after login (no login loop).
- **Settable or random PIN** — leave it empty for a random PIN, or type your own.
- **Toggleable** — the login requirement can be switched off for fully trusted
  scenarios (with a clear warning), and is enabled automatically whenever a
  tunnel is internet-facing.
- **Fixed tunnel URL (optional)** — by default Cloudflare hands out a new random
  subdomain on every start. With your own Cloudflare account + domain you can
  configure a **Named Tunnel** so the address stays the same on that machine
  (e.g. `https://liveplay.your-domain.com`). The token is stored **per machine**,
  not in the app bundle. See
  [`docs/web-sharing-stable-url.md`](docs/web-sharing-stable-url.md).

The mobile UI is a full responsive layout — collapsible playlist and cart,
full-screen Properties panel, touch-sized cart slots, and iOS safe-area / PWA
handling — not a shrunk desktop view.

Details and security notes:
[`docs/web-hosting-inapp-mac.md`](docs/web-hosting-inapp-mac.md). For
testing/building/releasing on macOS step by step, see
[`docs/test-build-release-mac.md`](docs/test-build-release-mac.md), and for
troubleshooting, [`docs/debugging-mac.md`](docs/debugging-mac.md).

---

## Hosting the web client (LAN, tunnel)

*(This is a fork feature.)* Beyond the in-app Share button, the web client can be
built as a standalone SPA and hosted behind your own reverse proxy or static
server. The full guide — with copy-paste Caddy / nginx / Traefik examples — is
[`docs/web-hosting.md`](docs/web-hosting.md). *(The repo no longer ships
ready-made deploy configs; bring your own.)*

| Mode | What it is | Use it for |
|------|------------|------------|
| **A — Same-origin proxy** | A reverse proxy (Caddy / nginx / Traefik) serves the SPA on `/` and proxies `/api/*` + `/ws` to the C++ server. No Mixed-Content, no CORS. | Permanent installs, fixed infrastructure |
| **B — Plain HTTP (event LAN)** | SPA over plain HTTP, server address typed manually (`http://<server-ip>:4480`). | Quick LAN setups at an event |
| **C — In-app (Mac)** | The desktop app serves the mobile UI itself + optional bundled Cloudflare tunnel. **No Docker needed.** | The one-click Share button above |

> ⚠️ Always put an auth gate (Traefik `basicauth` / Caddy `basic_auth`, or the
> in-app PIN) in front of an exposed server, and isolate the network. The C++
> server itself trusts whoever can reach it.

---

## Installing and using LivePlay

### Download a release

> **Note for this fork:** pre-built installers are published on the **upstream**
> [Releases page](https://github.com/tdoukinitsas/liveplay/releases). The
> fork-specific features above currently live in this repository's source — build
> from source (see below) to use them, or watch for them landing upstream.

| Platform | Files |
|----------|-------|
| Windows  | `LivePlay-Setup-x.y.z.exe` (NSIS installer, x64) |
| macOS (Apple Silicon) | `LivePlay-x.y.z-arm64.dmg` (also `-arm64-mac.zip`) |
| macOS (Intel) | `LivePlay-x.y.z.dmg` (also `-mac.zip`) |
| Linux    | `LivePlay-x.y.z.AppImage`, `liveplay_x.y.z_amd64.deb`, `liveplay-x.y.z.x86_64.rpm` |

macOS ships as **two separate per-architecture builds** — pick the Apple Silicon (`arm64`) build for M1/M2/M3 (and newer) Macs, and the Intel build for older Intel Macs.

The installer bundles **both** the Electron client and the `liveplay-server` binary. On first launch the client spawns the server as a child process listening on `127.0.0.1:4480`, so a single-machine install needs no configuration.

LivePlay auto-checks for new releases on launch and offers in-app updates via `electron-updater`.

### First launch on macOS ("LivePlay is damaged and can't be opened")

LivePlay's macOS builds are **not yet signed with an Apple Developer ID certificate or notarized**. macOS quarantines the app on download and Gatekeeper refuses to open it, usually with *"LivePlay is damaged and can't be opened."* The app is not actually damaged.

After dragging **LivePlay.app** into `/Applications`, remove the quarantine flag once from Terminal:

```sh
sudo xattr -rd com.apple.quarantine "/Applications/LivePlay.app"
```

Enter your password when prompted, then launch LivePlay normally. You only need to do this once per install (repeat it after each update). This applies to both the Apple Silicon and Intel builds.

### First launch on Windows ("Windows protected your PC")

LivePlay's Windows installer isn't yet signed with a certificate that Microsoft SmartScreen recognises (code signing via [SignPath](SIGNING.md) is in progress). Until then, Windows may show a blue **"Windows protected your PC"** dialog the first time you run the installer.

1. Click **More info** on the warning dialog.
2. Click the **Run anyway** button that appears, then continue the installation normally.

If your browser blocked the download instead, choose **Keep** to save the installer first.

### Network ports

A single-machine install talks to itself over `127.0.0.1` and needs nothing opened. When the client and server run on **different machines** on a LAN, make sure these ports are reachable through any firewalls in between:

| Port | Protocol | Used for |
|------|----------|----------|
| `4480` | TCP | Control surface — REST API + WebSocket (transport, project data, routing, live meters). |
| `4481` | UDP | LAN auto-discovery beacon (broadcast + multicast group `239.255.69.80`). Lets clients find servers without typing an IP. |
| `8088` | TCP | *(fork)* In-app Web-Sharing — the same-origin proxy + mobile UI served by the desktop app. |

On Windows the NSIS installer adds the necessary inbound firewall rules at install time; the app also makes a best-effort runtime pass if run elevated. On macOS/Linux, allow the `liveplay-server` binary through your firewall if you operate it remotely.

### Quick start

1. Install LivePlay and launch it.
2. Choose **New Project** and pick a folder — LivePlay creates the project file and a `media/` sub-folder there.
3. Drop audio files onto the playlist, or use **Import audio** to copy them in.
4. Click a cue to load it into the Properties panel, set in/out points, fade times, and routing.
5. Press a cart slot or hit the Play button to fire the cue. Live meters show signal at every stage.
6. *(fork)* To drive the show from a phone, hit **Share** in the header and scan the QR code.

For routing a stage-side server, open **Server Settings** and point the client at `http://<server-host>:4480`.

---

## Repository layout

```
liveplay/
├── client/         Electron + Nuxt 4 + Vue 3 desktop UI (also builds as a web app) — see client/README.md
│   ├── app/components/WebShareModal.vue      (fork) Share dialog: LAN / tunnel / PIN
│   └── electron/web-share.js                 (fork) proxy + tunnel + auth gate
├── server/         C++20 audio engine + REST/WS control server — see server/README.md
├── docs/           (fork) Web-hosting, web-sharing, stable-URL & macOS debugging guides
├── docs-site/      Public-facing Nuxt 4 site (GitHub Pages) — see docs-site/README.md
├── scripts/        Cross-platform build orchestrator scripts — see scripts/README.md
├── build/          Collected installer artefacts after `pnpm build`
├── .github/workflows/
│   ├── build-release.yml   Cuts releases on version bumps to package.json
│   ├── build-server.yml    Standalone server matrix build (Win / macOS / Linux)
│   └── deploy-docs.yml     Publishes the docs site to GitHub Pages
├── package.json    Monorepo root — orchestrator scripts only (pnpm workspaces)
├── pnpm-workspace.yaml   (fork) workspace + build-dependency config
├── LICENCE.txt     AGPL-3.0-only
└── README.md       This file
```

Each sub-package has its own README with developer documentation tailored to that area.

---

## Building from source

### Prerequisites

All platforms need:

| Tool | Minimum | Notes |
|------|---------|-------|
| Git  | any     | |
| Node.js | 20 LTS (CI uses 22 LTS) | for the client + orchestrator scripts |
| pnpm | 9.x | package manager (monorepo workspaces). Enable via `corepack enable` — the pinned version comes from the root `package.json` `packageManager` field. |
| CMake | 3.21   | for the server |
| C++20 toolchain | — | MSVC 2022 / Clang 15+ / GCC 12+ |
| [vcpkg](https://github.com/microsoft/vcpkg) | recent | `VCPKG_ROOT` env var must point at your checkout |
| Ninja | latest | strongly recommended (`brew install ninja`, `choco install ninja`, `apt install ninja-build`) |

> **Package manager:** this fork uses **pnpm** (upstream used npm). The easiest way
> to get the right version is Corepack (ships with Node ≥ 16):
> ```sh
> corepack enable          # makes the `pnpm` shim available
> corepack prepare pnpm@9.15.0 --activate   # optional: pin explicitly
> ```
> Alternatively `npm i -g pnpm@9`. All commands below use `pnpm`.

Set the `VCPKG_ROOT` environment variable:

```pwsh
# Windows (PowerShell, persistent)
[Environment]::SetEnvironmentVariable("VCPKG_ROOT", "C:\dev\vcpkg", "User")
```

```sh
# macOS / Linux
export VCPKG_ROOT="$HOME/dev/vcpkg"
echo 'export VCPKG_ROOT="$HOME/dev/vcpkg"' >> ~/.zshrc
```

Then from a clean checkout of this fork:

```sh
git clone https://github.com/4C-Winterberg-e-V/liveplay.git
cd liveplay
pnpm install               # installs workspace deps (client) via pnpm
pnpm build                 # builds server + client and collects installers into /build
```

`pnpm build` runs the unified pipeline in [scripts/build-all.js](scripts/build-all.js):

1. Configures and builds the C++ server through CMake/vcpkg.
2. On macOS, wraps the server binary into a `LivePlay Server.app` for DMG inclusion.
3. Runs `nuxt generate` and `electron-builder` in `client/`.
4. Copies the installer artefacts (`.exe`, `.dmg`, `.AppImage`, `.deb`, `.rpm`) into `build/`.

Use `pnpm build:clean` to wipe previous build outputs first (it preserves `vcpkg_installed/` so C++ deps don't get re-downloaded).

#### Building the web client (fork)

The client builds as a plain browser SPA — not just inside Electron — via a
`BUILD_TARGET` switch in [`client/nuxt.config.ts`](client/nuxt.config.ts):

```sh
cd client
BUILD_TARGET=web pnpm generate     # static SPA into client/.output/public
```

Serve the resulting `.output/public` from any static web server, or front it with
a reverse proxy — see [Hosting the web client](#hosting-the-web-client-lan-tunnel).

#### Platform-specific notes

##### Windows

- Install **Visual Studio 2022** with the *Desktop development with C++* workload (includes MSVC + Windows SDK).
- Install Node.js 20 LTS, CMake (≥ 3.21) and Ninja (e.g. `choco install nodejs cmake ninja`). Enable pnpm with `corepack enable`.
- Clone and bootstrap vcpkg:
  ```pwsh
  git clone https://github.com/microsoft/vcpkg C:\dev\vcpkg
  C:\dev\vcpkg\bootstrap-vcpkg.bat
  ```
- Set `VCPKG_ROOT` (see above), open a fresh PowerShell, `pnpm install`, then `pnpm build`.
- Output: `dist-electron/LivePlay-Setup-<version>.exe` (NSIS installer, x64). The `artifactName` uses hyphens (no spaces) so the local file, the GitHub release asset and the `latest.yml` auto-update manifest all reference the same name.

##### macOS

- Install Xcode Command Line Tools (`xcode-select --install`).
- Install Homebrew deps: `brew install node cmake ninja pkg-config`. Enable pnpm with `corepack enable`.
- Bootstrap vcpkg:
  ```sh
  git clone https://github.com/microsoft/vcpkg "$HOME/dev/vcpkg"
  "$HOME/dev/vcpkg"/bootstrap-vcpkg.sh
  ```
- Set `VCPKG_ROOT`, then `pnpm install && pnpm build`.
- Output: `build/LivePlay-<version>.dmg` on Intel, or `build/LivePlay-<version>-arm64.dmg` on Apple Silicon (each with a matching `.zip`). CI builds both x64 and arm64 **on Apple Silicon runners** — the Intel slice is cross-compiled with `-DCMAKE_OSX_ARCHITECTURES=x86_64`. To cross-build the Intel slice locally on an Apple Silicon Mac, configure the server with `-DCMAKE_OSX_ARCHITECTURES=x86_64` and run `electron-builder --mac --x64`.
- Code signing is skipped by default. Users will see a Gatekeeper warning on first launch — see [First launch on macOS](#first-launch-on-macos-liveplay-is-damaged-and-cant-be-opened).
- The in-app Web-Sharing feature is currently developed and documented against macOS first — see [`docs/web-hosting-inapp-mac.md`](docs/web-hosting-inapp-mac.md).

##### Linux

- Install build tools and audio dev headers:
  ```sh
  sudo apt update
  sudo apt install -y build-essential cmake ninja-build pkg-config \
                      libasound2-dev libpulse-dev libjack-jackd2-dev libx11-dev
  ```
  (use the equivalent `dnf` / `pacman` packages on Fedora / Arch).
- Install Node.js 20 LTS via your distro or [nvm](https://github.com/nvm-sh/nvm), then enable pnpm with `corepack enable`.
- Bootstrap vcpkg as on macOS, set `VCPKG_ROOT`, then `pnpm install && pnpm build`.
- Output: `build/LivePlay-<version>.AppImage`, `liveplay_<version>_amd64.deb`, `liveplay-<version>.x86_64.rpm`.
- *(fork)* On headless or VM Linux without a GPU, enable **software rendering** so the Electron client starts — see the client docs.

---

## Development workflow

From the monorepo root:

```sh
# One-time
pnpm install                     # installs workspace deps via pnpm
pnpm server:configure            # CMake configure for the server (idempotent)

# Iterating on the server only
pnpm server:build                # rebuild the C++ server
pnpm server:run                  # launch the compiled binary (forwards CLI args)

# Iterating on the client only — ensures the server is built first, then runs
# Nuxt + Electron in dev mode against it
pnpm dev

# Running both in side-by-side terminals (server in one pane, client dev in the other)
pnpm dev:all
```

The default `pnpm dev` calls [scripts/ensure-server.js](scripts/ensure-server.js),
which builds the server if needed. *(fork)* It now also **rebuilds the server when
its C++ sources have changed** and stops a stale detached server from a previous
dev run, so you don't end up driving an out-of-date binary. The Vite dev server
also accepts custom tunnel hosts, so you can test the web/tunnel path in dev.

Bumping versions across the monorepo:

```sh
pnpm run bump patch        # 2.0.0 → 2.0.1
pnpm run bump minor        # 2.0.0 → 2.1.0
pnpm run bump major        # 2.0.0 → 3.0.0
pnpm run version 2.1.4     # set an explicit version (use `run`: `pnpm version` is a built-in)
```

For deeper development notes:

- **Server internals** (mixer tiers, routing, LTC, project-file format, REST/WS surface): [`server/README.md`](server/README.md)
- **Client internals** (composables, IPC, Electron main process, localisation, MIDI/hotkeys): [`client/README.md`](client/README.md)
- **Web-sharing & hosting** *(fork)*: [`docs/web-hosting.md`](docs/web-hosting.md), [`docs/web-hosting-inapp-mac.md`](docs/web-hosting-inapp-mac.md), [`docs/web-sharing-stable-url.md`](docs/web-sharing-stable-url.md)
- **Build/utility scripts**: [`scripts/README.md`](scripts/README.md)
- **Public docs site**: [`docs-site/README.md`](docs-site/README.md)

---

## Releases & GitHub Actions

Release automation lives in [`.github/workflows/build-release.yml`](.github/workflows/build-release.yml).

1. Bump the version in the root `package.json` (use `pnpm run bump patch|minor|major`, which propagates to `client/package.json`).
2. Commit and push to `main`.
3. The `build-release` workflow detects the version change and runs the platform matrix:
   - **Windows x64** (MSVC, WASAPI)
   - **macOS Intel x64** (Clang, CoreAudio — cross-compiled `x86_64` on an Apple Silicon runner)
   - **macOS Apple Silicon arm64** (Clang, CoreAudio)
   - **Linux x64** (GCC, ALSA + PulseAudio + JACK)
4. Each job builds the C++ server through CMake/vcpkg, then runs the client `electron-builder` step with `extraResources` picking up the freshly compiled server binary.
5. A final `release` job downloads all artefacts, auto-generates a changelog from git commits since the last tag, and creates a GitHub Release tagged `v<version>`.

The vcpkg binary cache (`x-gha,readwrite` backend) is reused across runs. *(fork)*
CI runs on **Node 22 LTS** (upstream was on Node 20, now deprecated).

### Other workflows

- **[`build-server.yml`](.github/workflows/build-server.yml)** — builds the server alone on PRs and pushes that touch `server/**`. Cross-platform matrix; uploads `liveplay-server-<platform>` artefacts.
- **[`deploy-docs.yml`](.github/workflows/deploy-docs.yml)** — rebuilds the docs site when `docs-site/`, the root `README.md`, or `package.json` changes.

---

## Relationship to upstream

This fork tracks **[`tdoukinitsas/liveplay`](https://github.com/tdoukinitsas/liveplay)**
and aims to stay mergeable with it:

- The C++ audio engine, project-file format, routing model and core desktop UI
  are upstream's work, kept as close to upstream as practical.
- The fork's additions ([summary table](#-what-this-fork-adds-vs-upstream)) are
  deliberately scoped so they can be contributed back: the web build is gated
  behind `BUILD_TARGET`, and the sharing/proxy code lives in dedicated files
  (`client/electron/web-share.js`, `client/app/components/WebShareModal.vue`).
- All changes are AGPL-3.0-only, like upstream.

If you want the stock desktop experience, use upstream. Use this fork if you need
to **operate LivePlay from phones/tablets** or **host the UI for remote
operators**.

---

## Contributing

Contributions of all sizes are welcome — bug fixes, new features, translations, documentation, screenshots.

1. **Fork** this repo and `git checkout -b feat/something` off `main`.
2. **Build it locally** following the steps above. For server changes, run `pnpm server:build && pnpm server:run --verbose`. For client changes, `pnpm dev`. For web/sharing changes, test the Share flow end-to-end on a real device.
3. **Test your change**. There's no automated test suite yet — please verify the path you touched works end-to-end in the running app, and note any platform you couldn't test on in the PR.
4. **Open a PR** to `main`. CI must pass (server matrix build on the relevant platforms). If the change is broadly useful, consider proposing it upstream too.

### Style

- **Server** (C++20): atomics for hot params on the audio thread, no exceptions inside the audio callback, RAII everywhere, header-per-class.
- **Client** (TypeScript): Vue 3 Composition API with `<script setup>`. All audio + project state goes through `useLiveplayServer()` — components don't talk to the server directly. Keep browser/Electron differences behind feature checks so the web build degrades gracefully.
- **Commits**: short, prefer present-tense imperatives ("fix routing-matrix off-by-one"). Changelogs are generated from commit messages, so make them readable.

### Translations

LivePlay ships with 20 locale files at [`client/locales/`](client/locales/). To add a new language or fix existing translations:

1. Copy `en.json` to `<lang-code>.json` (e.g. `nl.json`).
2. Update the `_metadata` block (`code`, `name`, `nativeName`, `direction`).
3. Translate the values. Don't change keys; missing keys auto-fall-back to English at runtime.
4. Run `node scripts/sync-locale-keys.js` to ensure your new file has every key `en.json` has.
5. The locale is picked up automatically — no code changes needed.

For right-to-left languages, set `"direction": "rtl"` in `_metadata` and verify the layout in-app.

### Reporting bugs

For **fork-specific** issues (web-sharing, mobile UI, hosting kit, auth), file at
[github.com/4C-Winterberg-e-V/liveplay/issues](https://github.com/4C-Winterberg-e-V/liveplay/issues).
For bugs in the core engine or desktop app, consider upstream at
[github.com/tdoukinitsas/liveplay/issues](https://github.com/tdoukinitsas/liveplay/issues).
Include OS, LivePlay version (visible in the About dialog), and a minimal repro.

---

## License

[**AGPL-3.0-only**](LICENCE.txt) — same as upstream. Third-party dependencies retain their own licences (miniaudio: public domain / MIT-0; Crow: BSD-3; TagLib: LGPL-2.1+; nlohmann/json: MIT). The bundled `cloudflared` used for tunnels is distributed under its own licence by Cloudflare.

# LivePlay auf dem Mac debuggen (Web-Sharing / Cloudflare-Tunnel)

Praxisanleitung zum Debuggen der Desktop-App auf macOS — mit Fokus auf das
In-App-Web-Sharing und den `cloudflared`-Tunnel (`spawn ENOTDIR` & Co.), aber
generell nützlich.

> **Zwei Welten:**
> - **Dev (`pnpm dev`)** – schnell, Logs im Terminal. **Aber** der asar-/Packaging-
>   Fehler (`ENOTDIR`) tritt hier **nicht** auf (kein asar; `cloudflared` kommt
>   direkt aus `node_modules`). Gut für UI/Logik.
> - **Gepackte App (.app/DMG)** – hier lebt der Tunnel-Bug. Genau das musst du testen.

---

## 1. App bauen

```sh
cd ~/GIT/liveplay     # dein Mac-Checkout
git pull
pnpm install          # zieht u. a. cloudflared (bei pnpm 10 ggf. einmal: pnpm approve-builds)
pnpm build            # -> client/dist-electron/mac-arm64/LivePlay.app (+ DMG in build/)
```

Auf Apple Silicon entsteht der arm64-Build unter
`client/dist-electron/mac-arm64/LivePlay.app`.

## 2. App aus dem Terminal starten (= Main-Process-Logs sehen)

Statt per Doppelklick — so siehst du **alle `console.log`/`[web-share]`-Ausgaben** live:

```sh
"client/dist-electron/mac-arm64/LivePlay.app/Contents/MacOS/LivePlay"
```

Dann im Teilen-Dialog den Tunnel starten und im Terminal auf solche Zeilen achten:

```
[web-share] tunnel up: https://….trycloudflare.com
[web-share] cloudflared spawn error: …
[web-share] cloudflared exited (…)
```

## 3. Die gebündelte cloudflared-Binary direkt prüfen

Kern des `ENOTDIR`-Problems — existiert die Binary, ist sie die richtige
Architektur und ausführbar?

```sh
APP="client/dist-electron/mac-arm64/LivePlay.app"
BIN="$APP/Contents/Resources/app.asar.unpacked/node_modules/cloudflared/bin/cloudflared"

ls -la "$BIN"          # liegt sie da? (sollte nach dem asar-Fix existieren)
file "$BIN"            # Architektur? -> "arm64" erwartet, NICHT "x86_64"
"$BIN" --version       # läuft sie überhaupt?
```

- **„No such file"** → Binary wurde nicht mit-entpackt (asarUnpack/Build-Problem).
- **`file` zeigt `x86_64`** auf einem arm64-Build → Cross-Arch-Problem (falsche cloudflared-Arch).
- **`--version` „killed"/Gatekeeper** → Quarantäne (siehe 5).

## 4. cloudflared manuell testen (isoliert vom App-Code)

Beweist, ob die Binary selbst einen Quick-Tunnel aufbauen kann:

```sh
"$BIN" tunnel --no-autoupdate --url http://127.0.0.1:8088
```

Kommt eine `https://….trycloudflare.com`-Zeile → die Binary ist ok, das Problem
lag im App-Pfad (sollte mit dem asar-Fix erledigt sein). Kommt ein Fehler → es
liegt an der Binary/Arch/Netzwerk.

## 5. Quarantäne entfernen (unsignierter Build)

Falls die eingebettete Binary von Gatekeeper blockiert wird:

```sh
sudo xattr -rd com.apple.quarantine "$APP"   # rekursiv, inkl. cloudflared
```

## 6. Logs der installierten App (ohne Terminal-Start)

Wenn du die App normal aus `/Applications` startest: **Console.app** öffnen → oben
nach `LivePlay` filtern → Tunnel starten → Meldungen mitlesen. Tunnel-Fehler
erscheinen zusätzlich direkt im Teilen-Dialog (Fehlerzeile unter „Cloudflare tunnel").

## 7. Renderer/DevTools (für UI-Themen, nicht den Tunnel)

Gepackte App mit Dev-Flag starten:

```sh
"$APP/Contents/MacOS/LivePlay" --dev
```

(DevTools via Cmd+Opt+I; relevant für die Web-UI, nicht für den Main-Process-Tunnel.)

---

## Schnelle Diagnose-Matrix

| Beobachtung (Schritt 3/4) | Bedeutung | Lösung |
|---|---|---|
| Binary fehlt | nicht entpackt | asarUnpack/Build prüfen |
| `file` = x86_64 auf arm64 | Cross-Arch | per-Arch-`cloudflared` bündeln |
| `--version` „killed" | Quarantäne | Schritt 5 (`xattr -rd`) |
| manueller Tunnel ok, App nicht | App-Pfad (asar) | sollte durch den asar-Fix behoben sein → neu bauen |
| LAN fragt nach Passwort, keins sichtbar | Auth nur bei aktivem Tunnel scharf | Tunnel stoppen → LAN ist passwortfrei; bei aktivem Tunnel wird die PIN im Dialog gezeigt |

---

## Dev-Modus (UI/Logik, ohne Paket-Build)

```sh
LIVEPLAY_DISABLE_GPU=1 pnpm dev   # GPU-Flag nur auf headless/VM-Linux nötig, am Mac weglassen
```

- Main-Process-Logs (inkl. `[web-share]`) erscheinen im Terminal.
- Renderer-DevTools: Cmd+Opt+I.
- Hinweis: Der `ENOTDIR`/asar-Fehler ist hier **nicht** reproduzierbar — dafür Schritt 1–4.

---

## Was zuerst schicken

Für eine schnelle Ferndiagnose die Ausgaben von **Schritt 3** posten:

```sh
ls -la "$BIN"
file "$BIN"
"$BIN" --version
```

Damit lässt sich eindeutig sagen, ob es der asar-Pfad, die Architektur oder die
Quarantäne ist.

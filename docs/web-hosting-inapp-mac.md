# LivePlay Web-Client direkt aus der Mac-App teilen (In-App, ohne Zusatzsoftware)

Ziel: Die Mobile-/Web-Oberfläche **direkt aus LivePlay.app** an Handys/Tablets
ausliefern – im LAN **oder** über einen Cloudflare-Tunnel ins Internet, **ohne
dass irgendetwas außer LivePlay installiert sein muss** (kein Docker, kein
nginx/Caddy, keine WireGuard-App, kein VPS).

Das ist der vierte Hosting-Weg neben den proxy-/VPS-basierten Varianten in
[`web-hosting.md`](web-hosting.md) und [`web-hosting-vps-wireguard.md`](web-hosting-vps-wireguard.md).

```
                 LivePlay.app (Mac)
iPhone ─http(s)→  ┌───────────────────────────────────────────┐
                  │ Host-Server (Electron, 0.0.0.0:8088)      │
                  │  ├─ statische SPA            (/)           │  ← .output/public
                  │  └─ /api + /ws  ──proxy──→ 127.0.0.1:4480  │  ← gebündelter C++-Server
                  │ cloudflared (gebündelt) ──→ trycloudflare │  ← optionaler Tunnel
                  └───────────────────────────────────────────┘
```

Weil SPA **und** API/WS über **dieselbe Origin** laufen, gibt es **kein
Mixed-Content und keine CORS-Abhängigkeit**; der Client erkennt die Serveradresse
automatisch über `window.location.origin` – **keine manuelle Eingabe am Handy**.

---

## Benutzung (im laufenden Betrieb)

In der App: Kopfzeile → **Teilen** (Icon `share`; auf Mobile im ⋯-Menü).

- **Lokales Netzwerk:** „Starten" → QR-Code + Adresse `http://<mac-ip>:8088`
  erscheinen. Handy im selben WLAN scannt den Code und bekommt die volle
  Oberfläche, verbunden mit dem auf dem Mac laufenden Projekt.
- **Cloudflare-Tunnel:** „Starten" → die App startet das gebündelte
  `cloudflared` und zeigt eine `https://<zufall>.trycloudflare.com`-Adresse +
  QR. **Kein Cloudflare-Account, keine Domain, kein DNS** nötig (Quick-Tunnel).
  TLS macht Cloudflare; intern bleibt alles Plain-HTTP auf dem Mac.
  - **Feste URL (optional):** Die Quick-Tunnel-Adresse ist **bei jedem Start
    zufällig**. Wer ein eigenes Cloudflare-Konto + Domain hat, kann pro Rechner
    eine **dauerhaft gleiche** Adresse hinterlegen (Named Tunnel) – siehe
    [`web-sharing-stable-url.md`](web-sharing-stable-url.md). Bei hinterlegter
    Config zeigt der Dialog das Badge **„Feste URL"**.

Der C++-Server bindet ohnehin auf `0.0.0.0:4480`; der Host-Server proxyt nur
same-origin davor.

---

## Sicherheit (wichtig)

Der C++-Server hat **keine eigene Authentifizierung** und die API erlaubt
**Dateisystem-Zugriff** (`/api/fs/*`, Upload, beliebige Pfade).

- **LAN-Modus:** bewusst **ohne** Auth (reibungsloser QR). Nur in einem
  **vertrauten Netz** nutzen (Event-VLAN, kein Gäste-WLAN).
- **Tunnel-Modus:** internet-erreichbar → die App **erzwingt automatisch ein
  BasicAuth-Gate** für die *gesamte* geteilte Seite (HTTP **und**
  WebSocket-Handshake). Benutzer `liveplay`, **zufälliges Passwort pro Sitzung**,
  im Teilen-Dialog angezeigt. Der Tunnel-QR enthält die Zugangsdaten, damit der
  erste Aufruf am Handy automatisch authentifiziert (Safari merkt sie sich und
  sendet sie auch beim WS-Handshake mit).
- Da LAN und Tunnel denselben Host-Server teilen, gilt das Auth-Gate bei aktivem
  Tunnel auch für LAN-Clients – bewusst sicherer.
- **Auth optional:** Das BasicAuth-Gate lässt sich im Teilen-Dialog per Schalter
  „Login verlangen" abschalten (persistiert in `liveplay-webshare.json`,
  Standard: **an**). **Ist es aus, ist die geteilte Seite öffentlich** – jeder mit
  der URL kann den Server steuern und auf Dateien zugreifen. Umschalten wirkt
  sofort, auch bei bereits laufendem Tunnel.
- **Nach dem Event den Tunnel stoppen.** Beim App-Beenden wird er automatisch
  geschlossen.

---

## Build (nur Mac)

Es sind **keine** neuen Build-Schritte gegenüber dem normalen Electron-Build
nötig – die Mobile-UI ist dieselbe SPA, die ohnehin in `.output/public`
gebündelt wird (`pnpm build:electron`). Zusätzlich werden zur Laufzeit drei
npm-Abhängigkeiten genutzt, die electron-builder automatisch ins App-Bundle legt:

- `http-proxy` – Reverse-Proxy für `/api` + `/ws`.
- `qrcode` – QR-Codes (im Main-Prozess erzeugt).
- `cloudflared` – lädt beim `pnpm install` die passende `cloudflared`-Binary für
  die **Build-Plattform** und liefert ihren Pfad (`require('cloudflared').bin`).
  In `client/package.json` ist sie unter `asarUnpack` eingetragen, damit die
  Binary außerhalb des asar liegt und ausführbar ist.

```sh
cd client
pnpm install          # zieht u. a. cloudflared für die aktuelle Arch
pnpm build:electron
```

### Caveats für den Mac-Build

- **Cross-Arch:** Der `cloudflared`-npm-Postinstall lädt die Binary für die
  **Architektur des Build-Rechners**. Baust du auf Apple Silicon **beide**
  Slices (`arm64` + `x64`), enthält der x64-Slice eine arm64-`cloudflared`.
  Für saubere Universal-/Intel-Builds die jeweils passende Binary pro Arch
  bereitstellen – entweder per-Arch-CI-Job oder manuell unter
  `resources/bin/cloudflared` ablegen (der Code bevorzugt
  `process.resourcesPath/bin/cloudflared`, bevor er auf das npm-Paket
  zurückfällt). Für reine Apple-Silicon-Builds ist nichts zu tun.
- **Gatekeeper/Quarantäne:** Die Mac-Builds sind unsigniert (`identity: null`).
  Eine mitgebündelte Helfer-Binary (`cloudflared`) kann beim ersten Start in
  Quarantäne hängen. Wie für die App selbst ggf. einmalig entquarantänisieren:
  ```sh
  sudo xattr -rd com.apple.quarantine "/Applications/LivePlay.app"
  ```
  (entfernt das Flag rekursiv inkl. der eingebetteten Binaries).
- **App-Größe:** `cloudflared` ist ~30–50 MB pro Architektur.

---

## Implementierung (Kurzüberblick)

- `client/electron/web-share.js` – Host-Server (Static + Reverse-Proxy),
  cloudflared-Steuerung, BasicAuth-Gate, QR-Erzeugung.
- `client/electron/main.js` – IPC-Handler `web-share:*`, Event-Forwarding,
  Cleanup beim Beenden.
- `client/electron/preload.js` – `electronAPI.webShare.*`.
- `client/app/components/WebShareModal.vue` – Teilen-Dialog (QR, URLs, Login).
- `client/app/components/ProjectHeader.vue` – „Teilen"-Button (nur Electron).

Der Smart-Default in `useLiveplayServer.ts` (Same-Origin, wenn die Seite über
http(s) von einem Nicht-localhost-Host geladen wird) sorgt dafür, dass das Handy
ohne Konfiguration den richtigen Server findet.

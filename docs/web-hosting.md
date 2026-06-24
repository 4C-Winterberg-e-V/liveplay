# LivePlay Web-Client – Hosting-Anleitung

Der LivePlay-Client (Nuxt, `ssr: false`) kann als **statische Web-App** gehostet
und vom Smartphone-/Desktop-Browser im selben Netz bedient werden. Er verbindet
sich – wie die Desktop-App – per Serveradresse mit einem entfernten
**LivePlay v2 C++-Control-Server**.

> **Version & Protokoll:** Dieser Client spricht ausschließlich die **v2-API**
> (HTTP-Port **4480**, WebSocket **`/ws`**). Alte **v1.x-Builds (≤ v1.3.0)** sind
> inkompatibel. Das aktuell ladbare Upstream-Release ist v2.x – passend zu diesem
> Client.

Die Desktop-/Electron-Variante bleibt unverändert; alle hier beschriebenen
Schritte betreffen nur das Web-Hosting.

---

## 1. Build

Der Web-Build ist vom Electron-Build getrennt (eigenes npm-Script). Er nutzt eine
absolute `baseURL` statt der relativen `'./'` des Electron-Builds.

```bash
cd client
pnpm install
pnpm generate:web        # → client/.output/public
```

Das Ergebnis (`.output/public`) ist auf jedem statischen Webserver auslieferbar.

**Sub-Pfad-Hosting** (Auslieferung unter z. B. `/liveplay/`):

```bash
NUXT_APP_BASE_URL=/liveplay/ pnpm generate:web
```

Die Docker-Artefakte nehmen den Pfad als Build-Arg:
`--build-arg NUXT_APP_BASE_URL=/liveplay/`.

> Der Electron-Build (`pnpm generate` / `pnpm build:electron`) bleibt davon
> unberührt und verwendet weiterhin relative Pfade für `file://`.

---

## 2. Serveradresse im Browser

- **Mit Reverse-Proxy (Modus A):** Es ist **keine Eingabe nötig**. Wird die Seite
  über http(s) von einem Nicht-localhost-Host ausgeliefert, nimmt der Client
  automatisch `window.location.origin` als Serveradresse (Same-Origin). Der
  WelcomeScreen verbindet direkt.
- **Ohne Proxy (Modus B):** Im WelcomeScreen die Adresse `http://<server-ip>:4480`
  eingeben und auf **Verbinden** tippen. Sie wird in `localStorage` unter
  `liveplay.serverUrl` persistiert und bei jedem Start wiederverwendet.

Der eingegebene Wert wird vor dem Verbinden gegen `/api/health` geprüft; bei
Nichterreichbarkeit erscheint eine klare Fehlermeldung.

---

## 3. Hosting-Modi

### Modus A – Same-Origin-Proxy (empfohlen)

Ein Reverse-Proxy liefert die SPA unter `/` und proxyt `/api/*` und `/ws` auf den
C++-Server (`http://<server>:4480`). TLS terminiert am Proxy; die Strecke
Proxy → Server bleibt Plain-HTTP im LAN.

**Vorteile:** kein Mixed-Content, keine CORS-Abhängigkeit, keine manuelle
Adresseingabe (Same-Origin).

**Portabel (Caddy):**
```bash
# In deploy/docker-compose.mode-a-caddy.yml LIVEPLAY_SERVER_ADDR auf den
# C++-Server setzen (host:port). LIVEPLAY_SITE_ADDR=':80' (HTTP) oder ein
# echter Hostname für automatisches HTTPS.
docker compose -f deploy/docker-compose.mode-a-caddy.yml up --build
```

**Bestehende Traefik-Instanz:**
1. `deploy/traefik/docker-compose.snippet.yml` in den Traefik-Stack übernehmen
   (Host-Regel, certresolver, Netzwerk anpassen).
2. `deploy/traefik/liveplay-dynamic.yml` über den File-Provider einbinden und die
   Upstream-URL (`http://<server-ip>:4480`) eintragen. Diese Route hat höhere
   Priorität, damit `/api` und `/ws` vor der SPA greifen. Traefik leitet
   WebSocket-Upgrades automatisch weiter.

### Modus B – Plain-HTTP direkt (Event-LAN)

SPA über **reines HTTP** ausliefern; Serveradresse manuell `http://<server-ip>:4480`.
Bewusst kein HTTPS, um Mixed-Content zu vermeiden.

```bash
docker compose -f deploy/docker-compose.mode-b.yml up --build
# → http://<host-ip>:8080 im Browser öffnen
```

Alternativ ohne Docker: `.output/public` mit einem beliebigen statischen Server
ausliefern (`pnpm dlx serve .output/public`, nginx, …).

---

## 4. Mixed Content (wichtig)

Browser blockieren von einer **HTTPS-Seite** jeden Zugriff auf `http://` bzw.
`ws://`. Daraus folgt:

- **Modus A** löst das, weil SPA **und** API/WS über **dieselbe** (TLS-)Origin
  laufen – der Browser sieht nur `https`/`wss`.
- **Modus B** vermeidet es, weil die Seite selbst über **`http`** läuft – Seite
  und API teilen das Schema (`http`/`ws`).

**Nicht mischen:** Eine HTTPS-Seite, die direkt auf `http://<ip>:4480` zugreift,
wird vom Browser blockiert. Entweder durchgängig Proxy (A) **oder** durchgängig
HTTP (B).

---

## 5. ⚠️ Sicherheit – kein Auth, Dateisystem-Zugriff

Der C++-Server hat **keine Authentifizierung** und CORS ist offen (`*`). Die API
bietet **mehr als Playback** – u. a. **Dateisystem-Zugriff auf den Host**:

- `/api/fs/list`, `/api/fs/mkdir` – Verzeichnisse durchsuchen/anlegen
- `/api/upload`, `/api/project/import` – beliebige Datei-Uploads auf den Host
- `/api/project/load`, `/api/metadata?path=…`, `/api/waveform_path?path=…` – Zugriff
  über beliebige Pfade
- `/api/file/download?token=…`

**Konsequenz:** Jedes Gerät im Netz, das die Seite lädt und den Server erreicht –
und potenziell jede Website, die ein Opfer im Browser öffnet (CSRF-artig) – kann
den Server fernsteuern und Dateien lesen/schreiben.

**Empfehlung:**
- Den Server in ein **isoliertes/vertrautes Netz** legen (Event-VLAN, kein Gäste-WLAN).
- In **Modus A** ein **Auth-Gate am Proxy** vorschalten (kein Server-Umbau):
  - Traefik: `basicauth`-Middleware auf den Routern.
  - Caddy: `basic_auth`-Direktive im `Caddyfile`.

---

## 6. Manuelle Test-Matrix

Vor einem Event durchgehen. Voraussetzung: laufender **v2 C++-Server**
(`0.0.0.0:4480`), Firewall erlaubt eingehende Verbindungen, Client und Server im
selben Netz.

| # | Test | Erwartung | Status |
|---|------|-----------|--------|
| 1 | Web-Build `generate:web` | `.output/public` mit absoluten `/_nuxt/`-Pfaden | ✅ verifiziert |
| 2 | Sub-Pfad-Build | `/liveplay/_nuxt/`-Pfade | ✅ verifiziert |
| 3 | Electron-Build `generate` unverändert | relative `./_nuxt/`-Pfade | ✅ verifiziert |
| 4 | Locales im Browser | UI auf Deutsch/Englisch, **keine rohen Keys** | ✅ Bundle verifiziert |
| 5 | Desktop-Browser, Verbinden | Status „verbunden", Cue-Liste lädt | ⏳ Laufzeit |
| 6 | iPhone-Safari (gleiches LAN) | Seite lädt, Verbindung steht | ⏳ Laufzeit |
| 7 | Play/Stop einzeln | Cue startet/stoppt | ⏳ Laufzeit |
| 8 | Stop-All | alle Cues stoppen | ⏳ Laufzeit |
| 9 | Cart-Slot-Trigger | Slot löst Wiedergabe aus | ⏳ Laufzeit |
| 10 | Projekt laden, Waveforms | Cue-Liste + Waveforms erscheinen | ⏳ Laufzeit |
| 11 | Server neu starten | Auto-Reconnect + Connection-Lost-Modal | ⏳ Laufzeit |
| 12 | Browser-Konsole sauber | keine Errors aus fehlendem `electronAPI`, kein Log-Spam | ⏳ Laufzeit |
| 13 | Modus A: Mixed-Content | keine Mixed-Content-Blocks in der Konsole | ⏳ Laufzeit |
| 14 | Keine toten Buttons | YouTube/Cart-Detach/Version/Restart-Exit im Browser ausgeblendet | ✅ statisch verifiziert |

> **Hinweis:** Zeilen mit ⏳ erfordern einen laufenden v2-Server und eine echte
> Browser-Session; sie sind in der Build-Umgebung nicht ausführbar. Code- und
> Build-Ebene (✅) sind verifiziert.

---

## 7. Bekannte Web-Einschränkungen (Graceful Degradation)

Im Browser ausgeblendet bzw. ersetzt (kein Electron):

- **YouTube-Import** – Electron-only (yt-dlp), Button ausgeblendet.
- **Cart-Popout-Fenster** – Electron-Multiwindow, Button ausgeblendet.
- **App-Version / Auto-Update** – kein App-Binary im Browser, ausgeblendet.
- **mDNS-Server-Discovery** – kein UDP im Browser, Sektion ausgeblendet (Adresse
  manuell bzw. Same-Origin-Default).
- **„Audio hinzufügen"** – nativer Dialog nur in Electron; im Browser
  serverseitiger Datei-Browser (`/api/fs/list`) + Drag-and-drop-Upload (`/api/upload`).
- **ConnectionLost-Modal** – im Browser nur „Reconnect" (Neustart/Beenden sind
  Electron-Lifecycle).

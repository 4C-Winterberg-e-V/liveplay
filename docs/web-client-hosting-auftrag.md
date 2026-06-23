# LivePlay Web-Client – Arbeitsauftrag (überarbeitet)

> Revision nach Code-Audit. Die ursprüngliche Fassung enthielt Annahmen, die der
> tatsächliche Code teils widerlegt oder präzisiert. Geprüfte Quellen:
> `client/app/composables/useLiveplayServer.ts`, `client/nuxt.config.ts`,
> `client/app/components/ServerSettingsModal.vue`, `client/package.json`.

## Ziel
Den bestehenden Nuxt-Client von LivePlay (v2.x) so erweitern, dass er **als
statische Web-App gehostet** werden kann und sich – wie die Desktop-App – per
eingetragener Serveradresse mit einem entfernten LivePlay-**C++-Control-Server**
verbindet. Endziel: Bedienung vom Smartphone-Browser im selben Netz.

Die Desktop-/Electron-Variante muss dabei **unverändert lauffähig** bleiben.

## Kontext (bereits verifiziert – nicht neu erforschen)
- Client ist **Nuxt 4**, `ssr: false`. Build via `nuxt generate` → statisches `.output/public`.
- Verbindungs-Layer: `client/app/composables/useLiveplayServer.ts`.
  - `serverUrl` wird in `localStorage` unter `liveplay.serverUrl` gehalten, Default `http://127.0.0.1:4480`.
    **Wichtig:** Dieser Default wird **synchron beim Modul-Import** gelesen
    (`useLiveplayServer.ts:50-52`), bevor eine Komponente mountet.
  - `setServerUrl(url)` existiert (persistiert + reconnect). WebSocket unter `/ws`,
    abgeleitet via `http→ws`-Replace (`https→wss` funktioniert dadurch ebenfalls).
  - Gesamte Steuerung (Transport, Projekt-I/O, Devices, Routing, Waveforms, Uploads)
    läuft über `fetch()` + `WebSocket` – **keine** Electron-Abhängigkeit im Kernpfad.
- Server-CORS ist offen: `Access-Control-Allow-Origin: *` inkl. OPTIONS-Preflight
  (`server/src/net/control_server.cpp`). Cross-Origin ist vorgesehen.
- Electron-Aufrufe im Renderer sind mit `if (!window.electronAPI) return` o. ä.
  abgesichert (z. B. `PropertiesPanel.vue` `handleReplaceMedia`/`selectAudioFiles`,
  `CartPlayer.vue` `handleDetach`/`handleAttach`, `WelcomeScreen.vue`
  `getAppVersion`/`liveplayServer`, `resolveDroppedFileToMedia` mit Upload-Fallback).
  Verifiziert: durchgehend `if (!window.electronAPI) return` bzw. `electronAPI?.…`
  Optional-Chaining → keine geworfenen Fehler im Browser.
- **mDNS-Discovery ist Electron-only (NEU, für Phase 0/3):** `WelcomeScreen.vue` nutzt
  `electronAPI.liveplayDiscovery` (Scan/`solicit`/`recentAdd`/`recentRemove`). Im
  Browser per Optional-Chaining stillgelegt – wirft nicht, aber der „Server
  suchen"-Button bleibt **wirkungslos**. Browser-Nutzer haben keine Auto-Discovery
  und brauchen manuelle Eingabe bzw. den Smart-Default (Phase 2). In Phase 3
  ausblenden statt wirkungslos zeigen.
- Production-`baseURL`/`cdnURL` in `nuxt.config.ts` stehen auf `'./'` (für Electrons `file://`).
  Für Web-Hosting ungeeignet.
- **Versionshinweis (korrigiert):** Dieser Client (v2.1.2) spricht ausschließlich
  die v2-API (Port 4480, WS `/ws`). Das **neueste ladbare Release des Upstream-
  Projekts (`tdoukinitsas/liveplay`) ist v2.1.2** und entspricht genau dieser
  v2-/C++-Server-Architektur (verifiziert: Releases v2.0.5 … v2.1.2, Juni 2026).
  Der 4C-Winterberg-Fork selbst hat keine eigenen Releases/Tags.
  Inkompatibel sind nur die **alten v1.x-Electron-Builds (≤ v1.3.0)**: Sie sprechen
  eine andere API und lassen sich nicht mit einem v2-Server koppeln. Die frühere
  Behauptung „ladbares Release v1.2.9 (Electron) ist inkompatibel" war falsch —
  eine v1.2.9 existiert nicht, und das ladbare Release ist v2.

### Audit-Ergebnisse, die den Auftrag korrigieren (NEU)
Diese Punkte ändern den Umfang einzelner Phasen – vor Beginn beachten:

1. **Das Serveradress-Feld existiert bereits inkl. Web-Fallback.**
   `ServerSettingsModal.vue` hat einen Local/Remote-Modus-Schalter. Bei fehlendem
   `electronAPI` (`hasElectron = false`) erzwingt `loadConfig()` `draftMode = 'remote'`,
   befüllt das Feld aus `server.serverUrl`, und `apply()` ruft
   `server.setServerUrl(draftRemoteUrl)`. → **Phase 2 ist zu ~80 % erledigt.**
   Offen bleiben nur: (a) der Smart-Default und (b) ob das Modal im Browser
   überhaupt erreichbar ist (Trigger-Button hängt evtl. an einer Electron-only-Stelle).

2. **`/api/health` wird im Client nirgends aufgerufen.** Vorhanden ist `/api/whoami`
   (`{ clientIp, isLocal }`, siehe `refreshIsLocalServer`). Bevor Phase 3.2 gegen
   `/api/health` mit `name: "liveplay-server"` baut, **serverseitig verifizieren, ob
   Endpoint und Schema existieren**. Andernfalls ist das neuer Code, kein „nur prüfen".

3. **`rest()` und `wsSend()` sind mit `console.log`/`warn`/`error` auf jedem
   Request/Send durchsetzt** (Zeilen 174, 329, 335, 354, 367, 381 …). Das kollidiert
   mit dem Akzeptanzkriterium „keine Konsolen-Errors" und braucht ein Log-Gate
   (siehe Phase 3.3, NEU).

4. **Kleiner Bug:** `setServerUrl()` macht `disconnect(); connect()`, resettet aber
   **nicht** `failedReconnectAttempts`/`connectionLost` (das tut nur `forceReconnect()`).
   Nach URL-Wechsel kann das Connection-Lost-Modal hängen bleiben.

## Non-Goals
- Keine echte Authentifizierung **im Server** implementieren. **ABER:** Ein
  Auth-Gate **am Reverse-Proxy** (HTTP Basic / Token) ist kein Server-Umbau und
  wird in Modus A als empfohlene Standardkonfiguration aufgenommen (siehe Phase 4
  + Risiko-Abschnitt). Die „No-Auth"-Warnung ist auf „voller Dateizugriff"
  anzuheben, nicht nur „Playback".
- Den C++-Server nicht umbauen (CORS reicht). Bauen/Starten des Servers ist
  Voraussetzung für E2E-Tests, nicht Teil dieser Aufgabe.
- YouTube-Downloader und native Datei-Dialoge nicht in den Browser portieren.

## Vorgehen
Auf einem **Feature-Branch** arbeiten, kleine, in sich abgeschlossene Commits.
AGPL-Lizenzheader beibehalten. Bestehenden Code-Stil (Carbon Design,
Composable-Pattern) übernehmen.

> **Branch-Klärung (NEU):** Diese Umsetzung läuft auf `claude/beautiful-euler-bjk770`.
> Der ursprünglich genannte `feat/web-client-hosting` ist obsolet, sofern nicht
> ausdrücklich anders gewünscht.

### Phase 0 – Audit & bestätigen
1. **Bestätigt:** `setServerUrl` ist in `ServerSettingsModal.vue` verdrahtet und im
   Web-Fallback (`!electronAPI`) erreichbar. Offene Frage: **Ist der Öffnen-Trigger
   des Modals im Browser sichtbar/erreichbar?** Explizit prüfen (vgl.
   `LocalServerStatus.vue`, `ConnectionLostModal.vue`, Haupt-Toolbar).
2. Alle `window.electronAPI`-Aufrufstellen im Renderer auflisten und je Stelle das
   Browser-Verhalten dokumentieren (Fallback vorhanden / toter Klick / wirft Fehler).
   Kandidatenliste aus Grep: `useProject.ts`, `useStateViewer.ts`,
   `plugins/liveplay-server.client.ts`, `useLocalization.ts`, `useMidiController.ts`,
   `WelcomeScreen.vue`, `YouTubeImportModal.vue`, `PropertiesPanel.vue`,
   `ServerSettingsModal.vue`, `UpdateModal.vue`, `AudioImportModal.vue`,
   `CartPlayer.vue`, `CartSlot.vue`, `ConnectionLostModal.vue`,
   `LocalServerStatus.vue`, `MainWorkspace.vue`, `PlaylistView.vue`, `AboutModal.vue`,
   `app.vue`.
- **Akzeptanz:** Notiz im PR mit (1) Status des Serveradress-Felds **und seiner
  Erreichbarkeit im Browser** und (2) Liste der Electron-Call-Sites + Browser-Verhalten.

### Phase 1 – Web-Build-Target
1. Web-Build vom Electron-Build trennen, **ohne** den Electron-Build zu ändern.
   - **Stolperstein (NEU): `NODE_ENV` taugt NICHT als Weiche.** Sowohl `generate` als
     auch `build:electron` laufen mit `NODE_ENV=production`. Eine eigene Variable
     einführen, z. B. `BUILD_TARGET=web`.
   - **Stolperstein (NEU): explizites `app.baseURL` in der Config hat Vorrang vor
     `NUXT_APP_BASE_URL`.** Der Vorschlag „setze einfach die Env" greift dann
     stillschweigend nicht. Die Env **in der Config lesen**:
     ```ts
     baseURL: process.env.NUXT_APP_BASE_URL
       || (process.env.BUILD_TARGET === 'web' ? '/' : './'),
     ```
   - **`cdnURL` nicht vergessen (NEU):** steht hart auf `'./'`. Unter einem Subpfad
     zeigen die `_nuxt/`-Assets sonst falsch. Dieselbe Weiche wie `baseURL` geben
     (bzw. `NUXT_APP_CDN_URL`).
2. npm-Scripts ergänzen, z. B. `generate:web` (setzt `BUILD_TARGET=web` und ggf.
   `NUXT_APP_BASE_URL`) zusätzlich zum bestehenden `generate`.
- **Akzeptanz:**
  - `pnpm generate:web` erzeugt `.output/public`, lauffähig unter gewähltem Base-Pfad.
  - `pnpm build:electron` baut die Desktop-App **unverändert** (explizit verifizieren,
    dass `file://`-Laden weiter funktioniert – NEU als Regressionsschritt).
  - Optionaler Smoke-Test (NEU): nach `generate:web` prüfen, dass `index.html`/`_nuxt`-
    Referenzen den erwarteten Base-Pfad tragen.

### Phase 2 – Serveradresse im Browser eingeben
> Feld + Apply existieren bereits (siehe Audit). Verbleibende Arbeit:

1. Sicherstellen, dass der Modal-**Öffnen-Trigger** im Browser erreichbar ist
   (Phase-0-Ergebnis). Falls nicht: Einstiegspunkt ergänzen, der ohne `electronAPI`
   sichtbar ist.
2. **Smart-Default (NEU präzisiert):** Wenn kein gespeicherter Wert vorliegt **und**
   die Seite nicht über `localhost` läuft, als Default `window.location.origin`
   verwenden.
   - Muss **am synchronen Lese-Punkt** (`useLiveplayServer.ts:50-52`) greifen, bevor
     das Plugin `connect()` ruft – sonst verbindet der Client zuerst gegen
     `127.0.0.1:4480`.
   - **Gilt nur für Modus A (Proxy):** `window.location.origin` enthält **keinen
     Port 4480**. Für Modus B (Direkt-HTTP `http://<mac-ip>:4480`) bleibt manuelle
     Eingabe nötig – im README so dokumentieren.
3. **`setServerUrl` auf `forceReconnect`-Semantik anheben (NEU):** beim URL-Wechsel
   `failedReconnectAttempts`/`connectionLost` zurücksetzen, damit das
   Connection-Lost-Modal nicht hängen bleibt.
- **Akzeptanz:** Im Browser ohne `electronAPI` lässt sich die Serveradresse setzen,
  speichern und reconnecten; Verbindungsstatus sichtbar; kein hängendes
  Connection-Lost-Modal nach Wechsel.

### Phase 3 – Graceful Degradation
1. Für jede Electron-only-Funktion: im Browser sinnvoller Fallback oder Element
   ausblenden – **keine toten Buttons, keine geworfenen Fehler**. Konkret:
   - „Audio hinzufügen" → serverseitiger Datei-Browser (`/api/fs/list`) +
     Drag-and-drop-Upload (`/api/upload`); nativer Dialog nur bei `electronAPI`.
   - Cart-Popout-Fenster → Button nur bei `electronAPI`.
   - App-Version/Auto-Update → im Browser ausblenden.
   - **Blockierend (siehe Anhang A):**
     - **Lokalisierung:** Im Browser lädt `useLocalization` keine Locales → UI zeigt
       rohe Keys. Web-Locale-Pfad bauen (Bündeln oder `fetch()` der `client/locales/`-JSONs).
       Eigene Teilaufgabe; ohne sie ist die Web-UI unbrauchbar.
     - **YouTube-Import-Button** (`PlaylistView.vue:7`) im Browser ausblenden – Calls
       sind ungeguardet und der Button nur an `currentProject` gekoppelt.
     - **ConnectionLostModal:** im Browser nur „Reconnect" zeigen, Restart/Exit ausblenden.
2. Health-Check beim Start (NEU präzisiert): **zuerst serverseitig verifizieren,
   welcher Endpoint existiert** (`/api/health` vs. vorhandenes `/api/whoami`). Bei
   Nichterreichbarkeit klare Fehlermeldung. Optional `name: "liveplay-server"` prüfen,
   um versehentliche v1-Verbindung abzufangen – falls der Endpoint das liefert.
3. **Log-Gate (NEU):** `console.log`/`warn`/`error` in `rest()`/`wsSend()` hinter ein
   Debug-Flag legen (z. B. `localStorage 'liveplay.debug'` oder Build-Env), damit die
   Browser-Konsole im Normalbetrieb sauber bleibt. Andernfalls ist das
   Akzeptanzkriterium unten nicht erfüllbar.
- **Akzeptanz:** Im reinen Browser laufen: Projekt öffnen, Cue-Liste, Play/Stop,
  Cart-Trigger, Stop-All, Reconnect nach Server-Neustart. **Keine Konsolen-Errors
  und kein Request-Log-Spam.**
- **Umsetzungsstand (Code):**
  - ✅ Lokalisierung: Web-Locale-Bundle via Vite-Glob (`useLocalization.ts`) – im
    Browser werden alle 21 Locales gebündelt, kein IPC/Server nötig.
  - ✅ Log-Gate: `[liveplay]`-Request/Send-Logs hinter `LP_DEBUG`
    (`localStorage 'liveplay.debug'='1'` oder Dev).
  - ✅ YouTube-Button (`PlaylistView`), Cart-Detach (`CartPlayer`),
    ConnectionLostModal-Restart/Exit, AboutModal-Version, WelcomeScreen-mDNS:
    im Browser per `hasElectron` ausgeblendet.
  - ✅ „Audio hinzufügen" (`AudioImportModal`) hatte bereits Server-Browser +
    Upload-Fallback; nativer Dialog nur bei `electronAPI`.
  - ✅ Health-Check: existiert via `probeServerReachable('/api/health')` im
    WelcomeScreen-Connect-Flow.
  - ⏳ Laufzeit-Verifikation (echte Browser-Session gegen v2-Server) → Phase 5.

### Phase 4 – Hosting-Artefakte (zwei Modi)
**Modus A – Same-Origin-Proxy (empfohlen):** Reverse Proxy liefert SPA unter `/`
und proxyt `/api/*` und `/ws` auf den C++-Server (`http://<server>:4480`). TLS
terminiert am Proxy; Proxy→Server bleibt Plain-HTTP im LAN. Kein Mixed-Content,
keine CORS-Abhängigkeit; SPA nutzt automatisch `window.location.origin`.
- Liefern: Traefik-Labels/`docker-compose`-Snippet **und** alternativ eine Caddy-`Caddyfile`.
- **WebSocket-Hinweise (NEU):** Meter-Broadcasts sind hochfrequent und die WS ist
  langlebig. Idle-/Read-Timeouts am Proxy großzügig setzen, sonst kappt der Proxy
  die Verbindung. Caddy proxyt WS transparent (portabler Default); bei Traefik
  Upgrade-Weiterleitung/Timeouts explizit prüfen.
- **Auth-Gate (NEU, empfohlen):** HTTP Basic Auth bzw. Token am Proxy als
  Standard-Snippet beilegen (Traefik basicauth-Middleware / Caddy `basic_auth`).
  Kein Server-Umbau – schließt die im Risiko-Abschnitt beschriebene Dateisystem-
  Exposition.

**Modus B – Plain-HTTP direkt (Event-LAN):** SPA über **HTTP** ausliefern, Server-
adresse manuell `http://<mac-ip>:4480`. Bewusst kein HTTPS (Mixed-Content vermeiden).
- Liefern: `Dockerfile` (Multi-Stage: Build → statisches Nginx/Caddy-Image) + minimale Compose-Datei.
- **Hinweis (NEU):** Unsicherer HTTP-Kontext → iOS-Safari sperrt diverse Web-APIs
  und markiert „Nicht sicher". Für reines Playback unkritisch, aber dokumentieren.

- **Akzeptanz:** `docker compose up` liefert die SPA in beiden Modi; README beschreibt,
  wie die Serveradresse gesetzt wird bzw. dass sie im Proxy-Modus automatisch passt.
- **Umsetzungsstand (Artefakte in `deploy/`):**
  - ✅ Mode B: `Dockerfile` (Multi-Stage → Nginx), `nginx.conf` (SPA-Fallback),
    `docker-compose.mode-b.yml` (:8080).
  - ✅ Mode A Caddy: `Dockerfile.caddy`, `Caddyfile` (Serve + Proxy `/api`,`/ws`,
    Auto-HTTPS bei Hostname), `docker-compose.mode-a-caddy.yml`.
  - ✅ Mode A Traefik: `traefik/docker-compose.snippet.yml` (SPA-Service + Labels),
    `traefik/liveplay-dynamic.yml` (File-Provider-Route `/api`+`/ws` → externer Server).
  - ✅ `deploy/README.md`, Sub-Pfad via `--build-arg NUXT_APP_BASE_URL`.
  - ⏳ **Nicht real gebaut:** Compose-Syntax validiert (`docker compose config`),
    aber `docker build` lief in der Build-Umgebung nicht (kein Daemon). Der teure
    Build-Schritt `generate:web` ist separat verifiziert. Image-Build + `up` →
    Phase 5 / lokale Verifikation.

### Phase 5 – Doku & Test
1. `docs/web-hosting.md`: Build-Schritte, beide Hosting-Modi, Mixed-Content-Erklärung,
   **Sicherheitswarnung (NEU verschärft)**, Versions-/Port-Hinweis (v2, 4480, `/ws`).
2. Manuelle Test-Matrix abarbeiten und im PR dokumentieren:
   - Desktop-Browser + iPhone-Safari (gleiches LAN).
   - Play/Stop einzeln, Stop-All, Cart-Slot-Trigger.
   - Projekt laden, Cue-Liste/Waveforms.
   - Server neu starten → automatischer Reconnect + Connection-Lost-Modal.
   - Modus A: keine Mixed-Content-Blocks in der Konsole.
   - **Electron-Regression (NEU):** Desktop-App nach Config-Änderung startet und lädt.

## Wichtige Stolpersteine (für jede Entscheidung mitdenken)
- **Mixed Content:** HTTPS-Seite darf nicht auf `http://`/`ws://` zugreifen → Modus A oder Modus B.
- **baseURL/cdnURL:** Web ≠ Electron. `NODE_ENV` taugt nicht als Weiche; explizites
  Config-`baseURL` schlägt `NUXT_APP_BASE_URL`; `cdnURL` mitziehen. Electron-Pfad
  (`'./'`) nicht brechen.
- **Sync-Default:** Der `origin`-Default muss am Modul-Import-Punkt greifen, vor dem ersten `connect()`.
- **kein `sharp`:** Dieser Client hat keine `sharp`-Abhängigkeit – das frühere pnpm/WSL-Problem entfällt.

## Sicherheits-Risiko (NEU – im Auftrag bisher unterschätzt)
„No-Auth" bedeutet **mehr als „jeder kann Playback auslösen"**. Die offene API
(`useLiveplayServer.ts`) belegt **Dateisystem-Zugriff auf den Host**:
- `/api/fs/list` (Verzeichnisse durchsuchen), `/api/fs/mkdir` (Verzeichnisse anlegen)
- `/api/upload`, `/api/project/import` (beliebige Datei-Uploads auf den Host)
- `/api/project/load` mit beliebigem Pfad, `/api/metadata?path=…`, `/api/waveform_path?path=…`
- `/api/file/download?token=…`

Mit offener CORS-Policy (`*`) und ohne Auth kann **jedes Gerät im LAN – und jede
Website, die das Opfer im Browser öffnet (CSRF-artig) –** Dateien lesen/schreiben
und den Server fernsteuern. → **Empfehlung:** In Modus A standardmäßig ein
Proxy-Auth-Gate aktivieren (kein Server-Umbau) und das Netz isolieren. Die
README-Warnung entsprechend formulieren.

## Prerequisites für E2E-Test
Laufender LivePlay **v2 C++-Server** (Default `0.0.0.0:4480`), Firewall erlaubt
eingehende Verbindungen, Test-Client und Server im selben Netz.

---

## Anhang A – Phase-0-Audit: `electronAPI`-Call-Sites & Browser-Verhalten

Vollständige Auflistung aller `window.electronAPI`-Zugriffe im Renderer
(`client/app/`, ohne `electron/`-Hauptprozess). Klassifizierung:
- ✅ **Sauber** – geguardet, im Browser stiller No-Op, keine UI nötig oder bereits versteckt.
- ⚠️ **Inert/Politur** – wirft nicht, aber sichtbares Element ohne Wirkung bzw. degradierter Inhalt → in Phase 3 ausblenden/ersetzen.
- ❌ **Defekt/blockierend** – im Browser kaputt oder wirft (auch wenn gefangen); muss vor Web-Release behandelt werden.

### ❌ Blockierende Funde (vor Web-Release zwingend behandeln)

| Stelle | Verhalten im Browser | Maßnahme |
|---|---|---|
| **`useLocalization.ts:11`** (`loadLocales`) | `if (!electronAPI) return` → **keine Locale-Daten geladen**. `t(key)` gibt ab Z. 48-49 den **rohen Schlüssel** zurück. Die **gesamte Web-UI zeigt Keys** (`serverSettings.title` …) statt Text. | Web-Locale-Pfad: Locale-JSONs (`client/locales/`) ins SPA bündeln oder per `fetch()` laden. **Eigene Teilaufgabe, im Auftrag bisher gar nicht erfasst.** |
| **`YouTubeImportModal.vue:149,191,283,286`** (`searchYouTube`/`downloadYouTubeAudio`/`generateWaveform`/`readFile`) | Calls sind **ungeguardet**. Der Button (`PlaylistView.vue:7`) ist nur per `:disabled="!currentProject"` gesperrt, **nicht** auf `electronAPI` → mit offenem Projekt im Browser **klickbar**. Suche wirft `TypeError` (im try/catch gefangen → irreführende Fehlermeldung), Download tot. | Non-Goal sagt „nicht portieren" → **Button im Browser ausblenden** (`v-if="hasElectron"`). |

### ⚠️ Inert / Politur (Phase 3: ausblenden oder ersetzen)

| Stelle | Verhalten im Browser | Maßnahme |
|---|---|---|
| `ConnectionLostModal.vue:55,65` (`app.relaunch`/`app.exit`) | Modal **wird** im Browser bei Verbindungsverlust gezeigt; „Neustart"/„Beenden"-Buttons sind per `?.`-Chaining **tote Klicks**. | Im Browser nur „Reconnect" zeigen, Restart/Exit ausblenden. |
| `AboutModal.vue:90,104` & `WelcomeScreen.vue:267` (`getAppVersion`/`openExternal`) | Version bleibt auf Default (`1.1.3`/`1.1.3`), externe Links tot. | Version im Browser ausblenden; Links via `<a target=_blank>` statt `openExternal`. |
| `WelcomeScreen.vue` `liveplayDiscovery` (mehrfach) | mDNS-Scan wirkungslos (Optional-Chaining). | „Server suchen" im Browser ausblenden. |
| `LocalServerStatus.vue:52,64,76,84,94` (`liveplayServer.*`) | `if (!api) return` → Komponente komplett inert. | Im Browser ausblenden (Local-Modus existiert dort nicht). |
| `AudioImportModal.vue:126,182,203` (`selectAudioFiles`) | `hasElectron`-Computed; `pickLocal` No-Op; `pickAndUpload` hat **Browser-Fallback** (`importAudio.desktopOnly` + Upload-Pfad). | Bereits gut degradiert; nur „lokal wählen" im Browser ausblenden. ✅-nah |
| `CartSlot.vue:667` (`readFile` Waveform) | `if (electronAPI && waveformPath)` → File-Waveform übersprungen; Server-Waveforms greifen anderweitig. | Verifizieren, dass Server-Waveform-Pfad im Browser zieht. |

### ✅ Sauber (geguardet, stiller No-Op – keine Aktion nötig)

| Stelle | Hinweis |
|---|---|
| `plugins/liveplay-server.client.ts:22` | `electronAPI?.liveplayServer`; Web fällt auf localStorage-URL zurück – **der zentrale Web-Pfad**. |
| `useMidiController.ts:372,406` | MIDI-Config-Load/Save geguardet → MIDI ist Electron-only (Web-MIDI nicht genutzt). |
| `app.vue:276,409,475,511,513,348` | Menü-Listener + .lpa-Import komplett unter `if (window.electronAPI)`; Menüevents feuern im Browser nie. |
| `MainWorkspace.vue:145,309,333,367,378` | Großer Menü-/HTTP-API-Listener-Block + Export-Flow geguardet; Cart-Sync-Watch geguardet. |
| `useProject.ts:508,968` | `electronAPI?.liveplayProjects?.recentAdd` / `syncProjectData` Optional-Chaining → No-Op. |
| `useStateViewer.ts:17,80` | Dev-State-Viewer im Browser deaktiviert. |
| `UpdateModal.vue:146,152,174,186,194` | Alles geguardet; Modal nur auf Electron-Update-Events. |
| `useLiveplayServer.ts:885` (`getFilePath`) | Optional-Chaining mit Upload-Fallback (`resolveDroppedFileToMedia`). |
| `PropertiesPanel.vue:837` (`selectAudioFiles`) | `if (!window.electronAPI) return`. |
| `CartPlayer.vue:50,55` (Popout) | `if (!window.electronAPI) return`. |

### Status Serveradress-Feld (Phase-0-Frage 1 – AKTUALISIERT)
- **Korrektur:** `ServerSettingsModal.vue` ist **verwaist** – nirgends eingebunden;
  `LocalServerStatus.vue` ist in `app.vue:114` bewusst auskommentiert. Das Feld dort
  ist also für keinen Nutzer (Electron oder Web) erreichbar.
- **Der echte, im Browser erreichbare Eingabepfad ist `WelcomeScreen.vue`**
  (gemountet in `app.vue:26` via `v-if="!currentProject"`): Stage „remote" hat ein
  Adressfeld + „Connect", das `setServerUrl()` ruft und vorab `/api/health` probt
  (`probeServerReachable`). Die `electronAPI.liveplayServer.setConfig`-Aufrufe darin
  sind per Optional-Chaining geguardet → im Browser unschädlich. ✅
- **Phase-3-Hinweis:** Der „/api/health"-Probe-Endpoint existiert also bereits und
  wird genutzt – die Phase-3-Unsicherheit dazu ist geklärt.

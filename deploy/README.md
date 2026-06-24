# LivePlay Web-Client – Deployment-Artefakte

Hosting für den statischen Web-Client. Zwei Modi (Details in
[`../docs/web-hosting.md`](../docs/web-hosting.md)):

## Modus A – Same-Origin-Proxy (empfohlen)
Ein Reverse-Proxy liefert die SPA unter `/` und proxyt `/api/*` und `/ws` auf
den C++-Server. Kein Mixed-Content, keine CORS-Abhängigkeit; die SPA nutzt
automatisch `window.location.origin` (keine manuelle Adresseingabe nötig).

**Portabel (Caddy):**
```bash
# LIVEPLAY_SERVER_ADDR in der Compose-Datei auf den Server (host:port) setzen.
docker compose -f deploy/docker-compose.mode-a-caddy.yml up --build
```
- `Dockerfile.caddy` – Build der SPA + Caddy (Serve + Proxy).
- `Caddyfile` – Routing; `:80` (HTTP) oder echter Hostname → Auto-HTTPS.

**Bestehende Traefik-Instanz:**
- `traefik/docker-compose.snippet.yml` – SPA-Service mit Traefik-Labels.
- `traefik/liveplay-dynamic.yml` – File-Provider-Route für `/api` + `/ws` auf
  den **externen** C++-Server (kein Container).

## Modus B – Plain-HTTP direkt (Event-LAN)
SPA über reines HTTP; Serveradresse manuell `http://<server-ip>:4480`. Bewusst
kein HTTPS (vermeidet Mixed-Content).
```bash
docker compose -f deploy/docker-compose.mode-b.yml up --build
# → http://<host-ip>:8080
```
- `Dockerfile` – Build der SPA + Nginx (statisch).
- `nginx.conf` – SPA-Fallback, kein Proxy.

## Modus C – VPS + WireGuard (internet-facing, Cloudflare)
Web-Client auf einem VPS hinter Traefik/Cloudflare; `/api`+`/ws` laufen über einen
WireGuard-Tunnel zum Mac. Internet-erreichbar per HTTPS, **ohne Dev-Software auf
dem Mac** und ohne Server-Änderung. Same-Origin → kein Mixed-Content/CORS.
Schritt-für-Schritt: [`../docs/web-hosting-vps-wireguard.md`](../docs/web-hosting-vps-wireguard.md).
- `vps-wireguard/docker-compose.yml` – SPA-Service mit Traefik-Labels.
- `vps-wireguard/traefik-dynamic.yml` – File-Provider-Route `/api`+`/ws` → Mac über WireGuard.
- `vps-wireguard/wg0.vps.conf`, `vps-wireguard/liveplay.mac.conf` – WireGuard-Configs (Vorlagen).


## Sub-Pfad-Hosting
Beide Dockerfiles akzeptieren `--build-arg NUXT_APP_BASE_URL=/liveplay/` für
Auslieferung unter einem Unterpfad.

## ⚠️ Sicherheit
Der C++-Server hat **keine Authentifizierung** und gewährt über die API
**Dateisystem-Zugriff** (Browsen, Upload, beliebige Pfade). Jeder, der die Seite
lädt und den Server erreicht, kann ihn fernsteuern. **Netz isolieren** oder in
Modus A ein Proxy-Auth-Gate (Traefik basicauth / Caddy `basic_auth`) davorsetzen.

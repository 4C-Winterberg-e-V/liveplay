# LivePlay Web-Client über VPS + WireGuard (internet-facing, Cloudflare)

Internet-erreichbare HTTPS-Lösung für den Web-Client, **ohne Dev-Software auf dem
Mac** und **ohne Änderung am C++-Server**. Der VPS liefert die SPA und proxyt
`/api` + `/ws` über einen WireGuard-Tunnel an den Mac.

```
iPhone (überall)
  └─https→ Cloudflare ─https→ VPS (Traefik)
                                ├─ SPA-Container        (/)
                                └─ /api + /ws ─WireGuard→ Mac 10.10.0.2:4480
                                                          (LivePlay-Server)
```

**Warum das sauber ist:** Browser und API teilen **eine Origin** (`music.4cwt.de`)
→ kein Mixed-Content, kein CORS, keine manuelle Adresseingabe. TLS macht
Cloudflare/Traefik automatisch. Am Mac läuft nur die **WireGuard-App** (kein
Dev-Tool) + der **LivePlay-Server**, den du ohnehin hast.

> **Caveat:** Es braucht Internet am Veranstaltungsort — der Mac (für den Tunnel)
> und das iPhone (für Cloudflare). Fällt das Venue-Internet aus, fällt die
> Steuerung aus.

Dateien: [`deploy/vps-wireguard/`](../deploy/vps-wireguard/).

---

## Voraussetzungen
- VPS mit öffentlicher IP, Docker + **bestehende Traefik-Instanz**.
- Domain bei Cloudflare (hier `music.4cwt.de`).
- Mac mit der offiziellen **WireGuard-App** (App Store) und laufendem LivePlay-Server.

## 1 – WireGuard-Schlüssel erzeugen
Auf dem VPS (oder lokal mit installiertem `wireguard-tools`):
```bash
wg genkey | tee vps.key | wg pubkey > vps.pub      # VPS-Keypair
wg genkey | tee mac.key | wg pubkey > mac.pub      # Mac-Keypair
```
Du hast jetzt 4 Werte: `vps.key`, `vps.pub`, `mac.key`, `mac.pub`.

## 2 – VPS: WireGuard einrichten
`deploy/vps-wireguard/wg0.vps.conf` → `/etc/wireguard/wg0.conf` kopieren und füllen:
- `PrivateKey` = Inhalt von `vps.key`
- Peer `PublicKey` = Inhalt von `mac.pub`

Dann:
```bash
sudo systemctl enable --now wg-quick@wg0
sudo ufw allow 51820/udp     # WireGuard-Port öffnen
```

## 3 – Mac: WireGuard-Tunnel importieren
`deploy/vps-wireguard/liveplay.mac.conf` füllen:
- `PrivateKey` = Inhalt von `mac.key`
- Peer `PublicKey` = Inhalt von `vps.pub`
- `Endpoint` = `<VPS-öffentliche-IP>:51820`

In der WireGuard-App: **„Tunnel aus Datei importieren"** → Datei wählen →
**aktivieren**. Erscheint eine macOS-Nachfrage „eingehende Verbindungen für
LivePlay erlauben", auf **Erlauben** klicken.

**Tunnel testen** (auf dem VPS):
```bash
sudo wg show                          # zeigt latest handshake / transfer
curl http://10.10.0.2:4480/api/health # → {"ok":true,"name":"liveplay-server"}
```
Kommt hier eine gültige Antwort, steht der Tunnel und der Mac ist erreichbar.

## 4 – VPS: SPA-Container + Traefik-Route
1. Repo auf den VPS holen (oder `.output/public` vorbauen).
2. `deploy/vps-wireguard/docker-compose.yml` anpassen: `Host(...)`-Regel,
   `certresolver`, Traefik-Netzwerkname.
3. `deploy/vps-wireguard/traefik-dynamic.yml` in dein Traefik-Dynamic-Verzeichnis
   legen (File-Provider) — `Host(...)`, `certResolver` und die WireGuard-Upstream-IP
   prüfen.
4. Starten:
```bash
docker compose -f deploy/vps-wireguard/docker-compose.yml up --build -d
```

> **Erreicht Traefik den Tunnel?** Der Traefik-Container spricht `10.10.0.2`
> über das `wg0`-Interface des Hosts an; Dockers Standard-MASQUERADE sorgt für
> die Rückroute. Falls `liveplay-api` 502 liefert: auf dem VPS prüfen, dass
> `net.ipv4.ip_forward=1` gesetzt ist und `curl http://10.10.0.2:4480/api/health`
> **vom Host** klappt.

## 5 – Cloudflare
- **DNS:** `music.4cwt.de` → VPS-IP, **proxied (orange Wolke)**.
- **WebSockets:** sind bei proxied standardmäßig aktiv (Network-Einstellungen prüfen).
- **SSL/TLS-Modus:**
  - **Full (strict)** + **Cloudflare-Origin-Zertifikat** in Traefik (empfohlen,
    kein Renewal), **oder**
  - **DNS-01-Resolver** in Traefik (Cloudflare-Provider, automatische
    Let's-Encrypt-Certs) — dann passt der `certresolver`-Name in den Labels.

## 6 – Authentifizierung (BasicAuth am Proxy – aktiv)
Der LivePlay-Server hat **keine eigene Auth** und erlaubt u. a. Dateizugriff.
Sobald er über das Internet erreichbar ist, **muss** ein Gate davor.

Dieses Kit nutzt **Traefik-BasicAuth** statt Cloudflare Access — bewusst:
Cloudflare Access schützt nur den Weg *durch* Cloudflare. Wer die VPS-IP direkt
trifft (Port 443 offen), käme daran vorbei (außer man sperrt den Origin auf
CF-IP-Ranges). **BasicAuth sitzt am Traefik selbst und greift immer** — egal ob
über Cloudflare oder direkt per IP. Da alles über HTTPS läuft, wird das Passwort
verschlüsselt übertragen.

Die Middleware `liveplay-auth` ist bereits in `traefik-dynamic.yml` definiert und
an **beiden** Routern aktiv (API/WS im File, SPA via `liveplay-auth@file` in den
Compose-Labels) → die **ganze Seite** verlangt Login.

**Standard-Login:** Benutzer `liveplay`, Passwort `changeme` → **unbedingt ändern!**
Neuen bcrypt-Hash erzeugen und in `traefik-dynamic.yml` unter
`middlewares.liveplay-auth.basicAuth.users` eintragen:
```bash
htpasswd -nbB liveplay 'DEIN-PASSWORT'
# oder ohne htpasswd:
python3 -c "import crypt;print('liveplay:'+crypt.crypt('DEIN-PASSWORT',crypt.mksalt(crypt.METHOD_BLOWFISH)))"
```
Im File-Provider wird der Hash **unverändert** eingetragen (kein `$$`-Escaping —
das gilt nur für Hashes direkt in Compose-Labels).

> Das Login-Popup im Browser erscheint einmal; die PWA/Safari merkt sich die
> Zugangsdaten und sendet sie auch beim WebSocket-Handshake (gleiche Origin) mit.

## 7 – Benutzung
iPhone → `https://music.4cwt.de`. Der Client nutzt automatisch die eigene Origin
(Same-Origin-Proxy), verbindet sich und joint das auf dem Mac offene Projekt.
„Zum Home-Bildschirm hinzufügen" für den PWA-Modus.

## Troubleshooting
| Symptom | Ursache / Fix |
|---|---|
| `502` auf `/api/*` | Tunnel/Route: `wg show`, `curl http://10.10.0.2:4480/api/health` vom VPS-Host; `ip_forward`. |
| WS verbindet nicht | Cloudflare WebSockets aktiv? Traefik-Router matcht `Path(/ws)`? |
| Client fragt nach Projekt | Mac-Server hat kein Projekt offen → einmal öffnen; danach joinen alle automatisch. |
| Tunnel bricht ab | `PersistentKeepalive = 25` am Mac gesetzt? VPS-UDP-51820 offen? |

## Sicherheit
- **BasicAuth (Schritt 6) ist Pflicht** bei Internet-Exposition — Standardpasswort ändern!
  Greift auch bei direktem IP-Zugriff (kein Bypass wie bei Cloudflare Access).
- VPS-Firewall: nur `443` und `51820/udp` öffnen. Optional `443` zusätzlich auf
  Cloudflare-IP-Ranges beschränken (BasicAuth schützt aber auch ohne diese Sperre).
- WireGuard ist Punkt-zu-Punkt verschlüsselt; nur die `10.10.0.0/24` läuft durch
  den Tunnel, der restliche Mac-Traffic bleibt unangetastet.

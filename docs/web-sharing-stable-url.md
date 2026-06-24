# Feste (gleichbleibende) Tunnel-URL fürs In-App-Web-Sharing

Standardmäßig nutzt das In-App-Web-Sharing einen **Cloudflare Quick-Tunnel**
(`*.trycloudflare.com`). Dessen Subdomain wird von Cloudflare **bei jedem Start
zufällig** vergeben – es gibt **keinen** Parameter, um sie festzulegen. Über
App-Neustarts hinweg ändert sich die Adresse also immer.

Eine **dauerhaft gleiche** Adresse (auch nach Neustart/Reboot) bekommt man nur
mit einem **Named Tunnel** auf einem **eigenen Cloudflare-Konto + eigener
Domain**. Dann lautet die Adresse z. B. `https://liveplay.deine-domain.de` und
bleibt pro Rechner konstant.

> Hinweis: Die Config wird **pro Rechner** hinterlegt und ist **nicht** Teil des
> App-Bundles. So bleibt das Token lokal und jeder Rechner kann eine eigene
> feste Subdomain bekommen (z. B. `buehne1.…`, `buehne2.…`).

---

## Variante A – Token (empfohlen, am einfachsten)

Im Cloudflare **Zero-Trust-Dashboard** → *Networks → Tunnels*:

1. **Create a tunnel** → Typ *Cloudflared* → Namen vergeben (z. B. `liveplay-buehne1`).
2. Im Schritt **Install connector** den langen **Token** kopieren
   (`eyJ...`). Den Connector **nicht** manuell installieren – das übernimmt die App.
3. Reiter **Public Hostname** → *Add a public hostname*:
   - **Subdomain/Domain:** z. B. `liveplay` + `deine-domain.de`
   - **Service:** `HTTP` → `localhost:8088`

     > Der Teilen-Dialog hostet die UI fest auf Port **8088**, daher muss der
     > Dienst exakt auf `http://localhost:8088` zeigen.
4. In LivePlay: **Teilen → Cloudflare-Tunnel → „Feste URL einrichten"**:
   - **Hostname:** `liveplay.deine-domain.de`
   - **Token:** den kopierten Token einfügen → **Speichern**.

Beim nächsten „Starten" läuft der Named Tunnel und der Dialog zeigt das Badge
**„Feste URL"** mit `https://liveplay.deine-domain.de`.

---

## Variante B – Credentials-Datei (CLI, ohne Dashboard-Ingress)

Für Power-User mit lokal installiertem `cloudflared`:

```sh
cloudflared tunnel login                         # einmalig: Zone autorisieren
cloudflared tunnel create liveplay-buehne1       # erzeugt <UUID>.json (Credentials)
cloudflared tunnel route dns liveplay-buehne1 liveplay.deine-domain.de
```

Das ergibt eine Credentials-Datei (`~/.cloudflared/<UUID>.json`) und die
Tunnel-ID. Diese trägst du **nicht** über das App-Formular, sondern als Datei
oder Umgebungsvariablen ein (siehe unten). Den Ingress (Hostname → lokaler Port)
generiert die App zur Laufzeit selbst, daher passt sich der Port automatisch an.

---

## Wo die Config liegt

Reihenfolge (höchste Priorität zuerst):

### 1. Umgebungsvariablen (werden nie gebündelt)

```sh
# Variante A (Token):
export LIVEPLAY_TUNNEL_HOSTNAME="liveplay.deine-domain.de"
export LIVEPLAY_TUNNEL_TOKEN="eyJ..."
# optional, falls der Dashboard-Ingress einen anderen Port nutzt:
export LIVEPLAY_TUNNEL_PORT=8088

# Variante B (Credentials-Datei):
export LIVEPLAY_TUNNEL_HOSTNAME="liveplay.deine-domain.de"
export LIVEPLAY_TUNNEL_CREDENTIALS_FILE="$HOME/.cloudflared/<UUID>.json"
export LIVEPLAY_TUNNEL_ID="<UUID>"          # oder LIVEPLAY_TUNNEL_NAME
```

Sind Env-Vars gesetzt, ist das Formular im Dialog **nur lesbar** (Quelle: Env).

### 2. Datei `liveplay-tunnel.json` im userData-Ordner

Pfad wird im Teilen-Dialog unter „Konfigurationsdatei:" angezeigt. Typisch:

- **macOS:** `~/Library/Application Support/LivePlay/liveplay-tunnel.json`
- **Windows:** `%APPDATA%/LivePlay/liveplay-tunnel.json`
- **Linux:** `~/.config/LivePlay/liveplay-tunnel.json`

Inhalt – Variante A (Token):

```json
{
  "hostname": "liveplay.deine-domain.de",
  "token": "eyJ..."
}
```

Variante B (Credentials-Datei):

```json
{
  "hostname": "liveplay.deine-domain.de",
  "credentialsFile": "/Users/du/.cloudflared/0a1b2c3d-....json",
  "tunnelId": "0a1b2c3d-...."
}
```

Ist keine Config vorhanden, fällt das Web-Sharing automatisch auf den
zufälligen Quick-Tunnel zurück.

---

## Sicherheit

- Der **Token** erlaubt nur das Betreiben **dieses einen** Tunnels – kein
  Vollzugriff auf den Account. Trotzdem geheim halten und **nicht** in die App
  einbetten oder ins Repo committen; pro Rechner lokal hinterlegen.
- Das BasicAuth-Gate (Benutzer `liveplay` + zufälliger PIN) gilt unverändert,
  sobald der Tunnel oben ist – die feste URL ändert daran nichts.
- Eine feste, öffentlich gleichbleibende URL ist leichter auffindbar als eine
  zufällige. Tunnel nach dem Event stoppen; PIN nur an vertraute Personen geben.

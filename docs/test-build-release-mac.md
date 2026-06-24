# Web-Sharing testen, bauen & in GitHub veröffentlichen (Mac)

Schritt-für-Schritt für das In-App-Web-Sharing (LAN + Cloudflare-Tunnel) aus
[`web-hosting-inapp-mac.md`](web-hosting-inapp-mac.md). Drei Teile:

1. **Ohne Paket-Build testen** (Dev-Modus) — am schnellsten.
2. **Vollständiger Mac-Build** (DMG/ZIP).
3. **In GitHub veröffentlichen** (per CI **oder** manuell).

---

## Teil 1 — Ohne Paket-Build testen (Dev-Modus)

Hier wird **kein DMG** erzeugt. Du startest den Client im Dev-Modus; das
In-App-Hosting liefert die UI dann direkt vom laufenden Nuxt-Dev-Server aus
(ein Dev-Fallback im Host-Server, kein `pnpm generate` nötig).

> **Einmalige Voraussetzung:** Der C++-Audioserver ist eine kompilierte Binary.
> Beim ersten `pnpm dev` wird er automatisch gebaut — dafür braucht es
> einmalig die Server-Toolchain (siehe Teil 2, Voraussetzungen: Xcode CLT,
> `brew install cmake ninja pkg-config`, vcpkg + `VCPKG_ROOT`). Node 20 LTS ist
> ohnehin nötig.

```sh
git clone <fork-url> liveplay        # oder vorhandenen Checkout nutzen
cd liveplay
git checkout claude/tender-galileo-l78ztg
pnpm install                          # Root + client (pnpm workspace)
pnpm dev                          # baut den Server bei Bedarf, startet Nuxt + Electron
```

Dann in der App:

1. Projekt anlegen/öffnen (Sharing braucht ein offenes Projekt zum Bedienen).
2. Kopfzeile → **Teilen** (Icon `share`).
3. **Lokales Netzwerk → „Starten"**: QR + Adresse `http://<mac-ip>:8088`
   erscheinen.
   - Beim ersten Start fragt macOS evtl., ob „node"/„Electron" eingehende
     Verbindungen annehmen darf → **Erlauben**.
   - iPhone im **selben WLAN**: QR scannen → die Oberfläche lädt und ist mit
     dem Projekt auf dem Mac verbunden (Play/Stop, Carts, Meter).
4. **Cloudflare-Tunnel → „Starten"** (braucht Internet am Mac): die App zeigt
   eine `https://…trycloudflare.com`-Adresse + QR + **Login** (`liveplay` /
   Zufallspasswort). Auf dem Handy öffnen, Login eingeben (der QR enthält ihn
   bereits) → von überall erreichbar.

Stoppen über dieselben Buttons; beim App-Beenden wird der Tunnel automatisch
geschlossen.

> **Hinweis Dev-Modus:** Das Operator-Fenster auf dem Mac lädt über HMR
> (`localhost:3000`); das Handy bekommt dieselbe UI über den Host-Server
> (`:8088`) durchgereicht. Das ist nur zum Testen — für die Verteilung gilt
> Teil 2/3.

### Noch leichtgewichtiger (ohne Server-Toolchain)

Hast du bereits eine `liveplay-server`-Binary (z. B. aus den
`build-server.yml`-Artefakten der Actions), kannst du sie separat starten und
den Client per **Remote-Modus** auf `http://127.0.0.1:4480` zeigen lassen —
dann entfällt der lokale Server-Build. Für reines UI-Sharing-Testen reicht aber
Teil 1 wie oben.

---

## Teil 2 — Vollständiger Mac-Build (DMG/ZIP)

Erzeugt die verteilbaren Artefakte (`.dmg` + `.zip` pro Architektur).

**Voraussetzungen (einmalig):**

```sh
xcode-select --install                      # Xcode Command Line Tools
brew install node cmake ninja pkg-config
git clone https://github.com/microsoft/vcpkg "$HOME/dev/vcpkg"
"$HOME/dev/vcpkg"/bootstrap-vcpkg.sh
export VCPKG_ROOT="$HOME/dev/vcpkg"          # in ~/.zshrc dauerhaft machen
```

**Bauen:**

```sh
cd liveplay
pnpm install
pnpm build            # C++-Server + Client; sammelt Installer nach build/
```

Ergebnis in `build/`:
- Apple Silicon: `LivePlay-<version>-arm64.dmg` (+ `-arm64-mac.zip`)
- Intel: `LivePlay-<version>.dmg` (+ `-mac.zip`)

`pnpm install` lädt dabei per Postinstall die `cloudflared`-Binary; sie wird von
electron-builder ins App-Bundle gelegt (`asarUnpack`).

**Erststart (unsigniert):** Gatekeeper meldet ggf. „beschädigt". Einmalig
entquarantänisieren (entfernt das Flag auch von der eingebetteten
`cloudflared`-Binary):

```sh
sudo xattr -rd com.apple.quarantine "/Applications/LivePlay.app"
```

> **Cross-Arch-Caveat (cloudflared):** `pnpm install` zieht die `cloudflared`-
> Binary für die **Architektur des Build-Rechners**. Auf einem Apple-Silicon-Mac
> erhält der **Intel-Slice** dadurch eine arm64-`cloudflared`, d. h. der
> Tunnel-Button funktioniert auf echten Intel-Macs nicht. Für reine
> Apple-Silicon-Verteilung ist nichts zu tun. Brauchst du einen funktionierenden
> Intel-Build, lege die x64-`cloudflared` manuell unter
> `resources/bin/cloudflared` ab (der Code bevorzugt diesen Pfad) — sag
> Bescheid, dann verdrahte ich einen automatischen per-Arch-Download.

---

## Teil 3 — In GitHub veröffentlichen

### Option A — GitHub Actions (empfohlen, kein lokaler Toolchain nötig)

Der Workflow **„Build and Release"** baut die ganze Matrix (Windows, macOS
arm64 **und** x64, Linux) und legt eine GitHub-Release im Fork an. Er hat einen
manuellen Trigger (`workflow_dispatch`).

**A1 — Branch testen, ohne `main` zu berühren:**
1. Branch ist bereits gepusht (`claude/tender-galileo-l78ztg`).
2. GitHub → **Actions** → Workflow **„Build and Release"** → **Run workflow**
   → **Branch = `claude/tender-galileo-l78ztg`** → starten.
3. `workflow_dispatch` baut immer (unabhängig von Versionsänderung). Nach ~Lauf
   liegt unter **Releases** eine Version `v<package.json-version>` mit allen
   Installern (inkl. der Mac-DMGs).

> Achtung: Die Release wird mit `tag = v<version aus package.json>` erstellt.
> Läuft der Dispatch mehrfach mit derselben Version, kollidiert das Tag — vorher
> die Version bumpen (siehe A2) oder die alte Release/das Tag löschen.

**A2 — Regulärer Release über `main` (Versions-Bump):**
```sh
# auf einem Branch:
pnpm run bump patch        # 2.1.2 → 2.1.3 (propagiert in client/package.json)
git commit -am "chore: release v2.1.3"
# Branch nach main mergen (PR). Push von package.json auf main triggert den Build.
```
Der Workflow erkennt die Versionsänderung an `package.json` und cuttet die
Release automatisch.

### Option B — Lokal bauen + manuell hochladen

1. Mac-Build wie in Teil 2 → Dateien in `build/`.
2. GitHub → **Releases** → **Draft a new release**.
3. Tag wählen (z. B. `v2.1.3-test`), Titel/Beschreibung setzen.
4. `build/LivePlay-*-arm64.dmg` (und bei Bedarf den Intel-Build) als Assets
   hochladen → **Publish release**.

---

## Schnell-Checkliste

| Ziel | Befehl / Schritt |
|---|---|
| Nur Feature testen | `pnpm install && pnpm dev` → Teilen → LAN/Tunnel |
| DMG lokal bauen | `pnpm build` (vcpkg + cmake nötig) → `build/*.dmg` |
| Release über CI | Actions → „Build and Release" → Run workflow (Branch wählen) |
| Release über main | `pnpm run bump patch` → nach `main` mergen |
| Gatekeeper-Block | `sudo xattr -rd com.apple.quarantine "/Applications/LivePlay.app"` |

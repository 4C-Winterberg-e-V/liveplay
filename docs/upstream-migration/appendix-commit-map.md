# Appendix B — Every fork commit mapped to a package

113 non-merge commits in `3c3d27c..origin/main` (oldest first). Package IDs
refer to `packages/<ID>-*.md`. Other verdicts:

- **DONE UPSTREAM**: upstream fixed it independently.
- **SUPERSEDED**: upstream built its own equivalent.
- **OBSOLETE**: the code no longer exists upstream.
- **DROP**: not needed after the migration.
- **FORK-ONLY**: stays in the fork and never goes upstream.

Merge commits (20) are not listed.

| Commit | Date | Subject | → | Note |
|---|---|---|---|---|
| `09286d9` | 2026-06-23 | docs: überarbeiteter Web-Client-Hosting-Auftrag mit Audit-Korrekturen | **FORK-ONLY** | German work-order doc |
| `60d72cc` | 2026-06-23 | docs: Versionshinweis korrigiert (v2.1.2 ist das ladbare Release, kein v1.2.9) | **FORK-ONLY** | German work-order doc |
| `8307805` | 2026-06-23 | docs: Kontext-Block verifiziert + mDNS-Discovery-Hinweis ergänzt | **FORK-ONLY** | German work-order doc |
| `8292b72` | 2026-06-23 | docs: Phase-0-Audit ergänzt (alle electronAPI-Call-Sites + Browser-Verhalten) | **FORK-ONLY** | German work-order doc |
| `acc2776` | 2026-06-23 | feat(client): Web-Build-Target via BUILD_TARGET-Weiche | **DROP** | BUILD_TARGET=web build not needed: sharing serves the normal build (see W1) |
| `e36fa7b` | 2026-06-23 | chore: ignore client/dist symlink von nuxt generate | **DROP** | only for the BUILD_TARGET=web build |
| `2c9747e` | 2026-06-23 | feat(client): Phase 2 - Serveradresse im Browser (Smart-Default + Auto-Skip) | **W1** | server address in the browser |
| `de95613` | 2026-06-23 | feat(client): Phase 3 - Graceful Degradation im Browser | **W1** | graceful degradation in the browser |
| `1f02dfb` | 2026-06-23 | feat(deploy): Phase 4 - Hosting-Artefakte fuer Mode A und Mode B | **DROP** | hosting kit, removed again in df02972 |
| `c8f6940` | 2026-06-23 | docs: Phase 5 - web-hosting.md (Anleitung + Test-Matrix) | **FORK-ONLY** | German hosting guide (W2 writes English docs) |
| `9e81c7f` | 2026-06-24 | fix(client): CORS-simple REST requests fuer Cross-Origin-Hosting | **DROP** | upstream answers CORS preflight (#62); sharing is same-origin |
| `f6d14bd` | 2026-06-24 | feat(client): Mobile-Responsive-Pass fuer schmale Viewports | **M1** | first mobile pass, superseded by babaab9 |
| `ad2c8cd` | 2026-06-24 | fix(client): keine WS-Fehlerschleife auf Static-Host + Favicon | **W1** | no WS error loop on a static host (favicon/meta → M3) |
| `f91917d` | 2026-06-24 | fix(client): iOS Safe-Area-Insets fuer PWA-Standalone | **M1** | iOS safe-area insets |
| `1b447b7` | 2026-06-24 | feat(client): aufgeraeumte Kopfzeile auf Mobile (Option C) | **M1** | mobile header, superseded by babaab9 |
| `7068a52` | 2026-06-24 | feat(deploy): VPS + WireGuard Hosting-Kit (Traefik, internet-facing) | **DROP** | VPS/WireGuard kit, removed in f575208 |
| `1f046eb` | 2026-06-24 | feat(deploy): Traefik BasicAuth-Gate fuers VPS-WireGuard-Kit | **DROP** | VPS/WireGuard kit, removed in f575208 |
| `fcfcb17` | 2026-06-24 | feat(client): In-App Web-Sharing fuer Mac (LAN + Cloudflare-Tunnel) | **W2/W3** | in-app web sharing (LAN → W2, tunnel → W3) |
| `35223eb` | 2026-06-24 | feat(client): Dev-Fallback fuers Web-Sharing + Test/Build/Release-Anleitung | **W2** | dev fallback; its Mac guide stays FORK-ONLY |
| `13003dc` | 2026-06-24 | build: auf pnpm umstellen (Workspace, CI) + README/Doku | **DROP** | pnpm migration — upstream uses npm |
| `cade162` | 2026-06-24 | fix(scripts): ensure-server cmake-Aufrufe aus server/ ausfuehren | **T1** | cmake must run from server/ |
| `e5c1655` | 2026-06-24 | fix(scripts): pnpm-Workspace-Filter auf Pfad ./client umstellen | **DROP** | pnpm filter |
| `180e772` | 2026-06-24 | feat(client): optionales Software-Rendering fuer headless/VM-Linux | **E1** | opt-in software rendering |
| `86cd508` | 2026-06-24 | fix(client): Cloudflare-Tunnel-Hosts im Vite-Dev-Server erlauben | **W2** | dev-server allowedHosts |
| `9c2c8c0` | 2026-06-24 | feat(client): kuerzeres Tunnel-Passwort ohne doppeldeutige Zeichen | **W2** | PIN format |
| `f33f657` | 2026-06-24 | fix(client): Login-Schleife im Tunnel beheben (Session-Cookie fuer WS) | **W2** | session cookie so the WS survives login |
| `67e566d` | 2026-06-24 | feat(client): Projekt beim Start nicht automatisch uebernehmen (Local) | **U1** | resume prompt instead of silent rejoin |
| `7b488c7` | 2026-06-24 | feat(client): Tunnel-Login als 6-stellige PIN | **W2** | PIN format |
| `c4d7321` | 2026-06-24 | feat(client): Playlist auf dem Handy einklappbar | **M1** | collapsible playlist, superseded by the deck tabs |
| `72dd5fb` | 2026-06-24 | feat: 4-stellige Tunnel-PIN + touch-optimierte Cart-Slots auf Mobile | **W2 + M2** | PIN length (W2); touch cart slots (M2) |
| `782dafc` | 2026-06-24 | feat(client): Tunnel-PIN pro App-Sitzung stabil halten | **W2** | PIN stable per app session |
| `84a675f` | 2026-06-24 | feat(client): Properties-Panel auf dem Handy als Vollbild | **M1** | properties panel as a full-screen sheet |
| `3e2d77b` | 2026-06-24 | fix(client): slider-vertical Deprecation entfernen | **U1** | slider-vertical deprecation |
| `e520cac` | 2026-06-24 | fix(client): Playlist-/Gruppenzeile auf Mobile lesbar (Name vs. Icons) | **M2** | readable one-line rows |
| `dbbe569` | 2026-06-24 | feat(client): Top-Controls auf Mobile stapeln statt scrollen | **M1** | stacked top controls, superseded by babaab9 |
| `bb4b67b` | 2026-06-24 | feat(client): Cart Player auf dem Handy einklappbar + Attach ausblenden | **M1** | collapsible cart, superseded by the deck tabs |
| `ce6e81f` | 2026-06-24 | feat(client): Mobile-Layout aufgeraeumt (Transport in Titelleiste, Header schlanker, dunkler BG) | **M1** | mobile layout cleanup, superseded by babaab9 |
| `004acfa` | 2026-06-24 | fix(client): Mobile-Header-Politur + aktiver Cue passt sich an | **M1** | header polish |
| `ed5dc5d` | 2026-06-24 | fix(client): Song-/Gruppen-Edits live an andere Clients spiegeln | **DROP** | reverted by d8a2bc2 |
| `329ff26` | 2026-06-24 | ci: Build-Node auf 22 LTS heben (Node 20 deprecation) | **T2** | Node 22 LTS |
| `06b4e6b` | 2026-06-24 | fix(client): Tunnel-Spawn (asar) + LAN-Auth/PIN-Anzeige + Fehlermeldung | **W2/W3** | tunnel spawn from asar (W3), LAN PIN display (W2) |
| `fec0a9f` | 2026-06-24 | build: onlyBuiltDependencies nach pnpm-workspace.yaml verschieben (pnpm 10) | **DROP** | pnpm |
| `ed73b61` | 2026-06-24 | docs: Mac-Debugging-Anleitung (Web-Sharing / cloudflared-Tunnel) | **FORK-ONLY** | Mac debugging guide |
| `d8a2bc2` | 2026-06-24 | Revert "fix(client): Song-/Gruppen-Edits live an andere Clients spiegeln" | **DROP** | revert of ed5dc5d |
| `656cc74` | 2026-06-24 | fix(client): findItemByIndex gegen stale/out-of-range Index absichern | **DONE UPSTREAM** | findItemByIndex guard — upstream 1df20e9 |
| `bfd4868` | 2026-06-24 | feat(web-share): optionale feste Tunnel-URL pro Rechner (Named Tunnel) | **W3** | named (fixed-URL) tunnel |
| `b48f324` | 2026-06-25 | feat(web-share): Auth-Gate optional schaltbar | **W2** | switchable PIN gate (hardened in W2) |
| `b546412` | 2026-06-25 | feat(web-share): manuell vergebbare PIN | **W2** | operator-chosen PIN |
| `66899a3` | 2026-06-25 | Confine server filesystem access to a sandbox; stop dialogs opening at "/" | **SUPERSEDED + F1 + E1** | server sandbox → upstream fs allow-list; upload fallback → F1; dialog start folder → E1 |
| `72f8534` | 2026-06-25 | fix(electron): Edit-Menue fuer Copy/Paste ergaenzen | **E1** | Edit menu (copy/paste on macOS) |
| `a0fc906` | 2026-06-25 | fix(dev): Vite-Dev-Server erlaubt eigene Tunnel-Hosts | **W2** | dev-server allowedHosts |
| `1e03583` | 2026-06-25 | Rebuild the C++ server when its sources change in ensure-server.js | **T1** | rebuild the server when sources change |
| `a248d0f` | 2026-06-25 | feat(x18): Behringer X18 Master-/Kanal-Fader bei Lied-Start/Stop steuern | **X1** | fader actions on cue start/stop |
| `d73afbd` | 2026-06-25 | feat(x18): Mute-Gruppen + X18-Steuerungsboard (Hauptansicht mit Tasten) | **X1 + X2** | mute/mute-group actions (X1); control board (X2) |
| `225dd72` | 2026-06-25 | fix(x18): Board-Tasten im Edit-Modus nicht live ans Pult senden | **X2** | edit mode does not send to the desk |
| `f0da125` | 2026-06-25 | fix(x18): Editor-Fenster bleibt beim Anlegen eines Buttons offen | **X2** | editor stays open |
| `751f351` | 2026-06-25 | Stop the stale detached server after a dev rebuild | **T1** | stop the stale detached server |
| `374263e` | 2026-06-25 | fix(x18): Board-Tasten ohne konfigurierte IP nicht ans Backend senden | **X1/X2** | no IP → nothing sent |
| `f5070dc` | 2026-06-25 | docs(readme): state-of-the-art README focused on fork differences | **FORK-ONLY** | fork README |
| `f575208` | 2026-06-26 | Remove VPS + WireGuard hosting kit | **DROP** | removes 7068a52/1f046eb |
| `d2aebda` | 2026-06-26 | Drop stale WireGuard mention from web-share comment | **W2** | comment fix |
| `39535eb` | 2026-06-26 | docs: add Phase 1 code review & audit report | **FORK-ONLY** | code review report |
| `7b726cc` | 2026-06-26 | docs(review): re-rate findings for the closed/small-event operating model | **FORK-ONLY** | code review report |
| `df02972` | 2026-06-26 | chore: remove deploy/ hosting kit, consolidate on in-app sharing | **DROP** | removes the deploy kit |
| `8928039` | 2026-06-26 | docs(review): correct threat-model reasoning (CF Access, 0.0.0.0 required) | **FORK-ONLY** | code review report |
| `39f5fd3` | 2026-06-26 | docs(review): reconcile report after merging main (PR #9 removed deploy/) | **FORK-ONLY** | code review report |
| `b33d577` | 2026-06-26 | fix(C-02): repoint auto-updater and publish target from upstream to the fork | **FORK-ONLY** | auto-updater/publish → fork; never upstream |
| `e0fa8f0` | 2026-06-26 | docs(review): record Critical-tier dispositions (C-01 deferred, C-02 fixed) | **FORK-ONLY** | code review report |
| `6622213` | 2026-06-26 | fix(server): atomic project save + recursion guard (M-17, H-15) | **S1 (half)** | recursion guard → S1; atomic save already upstream |
| `d425b83` | 2026-06-26 | fix(client): dispose useAudioEngine server subscriptions on scope teardown (H-19) | **C1** | release useAudioEngine subscriptions |
| `5a12a81` | 2026-06-26 | build(M-38): commit pnpm-lock.yaml for reproducible installs | **DROP** | pnpm lockfile |
| `3fa1991` | 2026-06-26 | test(server): add doctest+CTest unit-test harness, wired into CI (Wave 2) | **T2 (CI half)** | ctest in CI → T2; doctest itself dropped; tests converted per package |
| `c68ed7f` | 2026-06-26 | fix(server): stop resetting the LTC encoder every render block (H-16) | **DONE UPSTREAM** | LTC encoder no longer reset per block |
| `2fae07d` | 2026-06-26 | fix(server): hold shared ownership of cues in the broadcast loop (H-14) | **S1** | broadcast-loop cue lifetime |
| `ead7049` | 2026-06-26 | build(client): add vue-tsc + `typecheck` script (test-net groundwork) | **OPTIONAL T3** | vue-tsc |
| `e0596b6` | 2026-06-26 | fix(client): read isLocalServer as a value, not a ref (real behaviour bug) | **DONE UPSTREAM** | isLocalServer.value call sites gone |
| `82eeebc` | 2026-06-26 | fix(client): type-safe watch old-value in PlaylistView (no behaviour change) | **OBSOLETE** | code no longer exists upstream |
| `ac25f83` | 2026-06-26 | ci(client): add vue-tsc typecheck gate for the client | **OPTIONAL T3** | client typecheck CI |
| `e672644` | 2026-06-26 | test(client): Vitest harness + extract & test the item-sync diff logic | **C1** | projectDiff extraction; Vitest → node script |
| `b6b48ea` | 2026-06-26 | fix(client): recover from failed item-sync instead of silently desyncing (H-17) | **C1** | item-sync rollback and retry |
| `cf4820e` | 2026-06-26 | docs(review): record Phase 2 implementation status; defer H-18 | **FORK-ONLY** | code review report |
| `cd1af47` | 2026-06-27 | deps(client): patch audit-flagged vulnerabilities (electron, vitest, uuid) | **OPTIONAL T4** | dependency bumps — re-evaluate against upstream's audit |
| `6924620` | 2026-06-27 | docs(review): record dependency security pass (audit 7 -> 0) | **FORK-ONLY** | code review report |
| `2abe832` | 2026-06-27 | fix(server): validate/repair document on replace_full_document (M-16) | **S1** | repair on full-document replace |
| `cb4723f` | 2026-06-27 | fix(server): guard media decode against pathological files (M-04, H-20) | **S1** | pathological-media guards (cherry-picks cleanly) |
| `092135d` | 2026-06-27 | docs: correct stale facts — Nuxt 3->4, hosting section (M-48, N-1) | **DROP** | upstream rewrote those docs |
| `9ed75c9` | 2026-06-27 | deps(web-share): migrate http-proxy@1 -> http-proxy-3 (M-32) | **W2** | http-proxy-3 |
| `9aae3c4` | 2026-06-27 | docs(review): defer M-26/M-27 (maintainability debt); record M-16/M-04/H-20/M-32 status | **FORK-ONLY** | code review report |
| `f8d9c4a` | 2026-06-27 | test(server): unit-test the OSC wire encoder; make it socket-free | **X1** | OSC encoder test (converted) |
| `4555683` | 2026-08-04 | feat(audio): select which hardware output channels a cue plays out of | **SUPERSEDED + A1** | channel model → buses/output map; native channel count → A1 |
| `61f4237` | 2026-08-04 | fix(client): make the phone transport reachable and surface X18 in the bar | **M1 + X2** | phone transport (M1); X18 tab in the bar (X2) |
| `babaab9` | 2026-08-05 | feat(client): rebuild the mobile UI as a touch-first operating surface | **M1 + M2 + U1** | shell (M1), touch (M2), Stop All + delete dialog (U1) |
| `6803d5d` | 2026-08-05 | fix(client): harden the mobile touch model after self-review | **M1/M2** | touch-model hardening |
| `4f0be02` | 2026-08-05 | feat(client): ship an installable PWA to reclaim the browser chrome | **M3** | PWA |
| `c06f122` | 2026-08-06 | fix(client): scope the seek scrub to the pointer that pressed the bar | **M2** | seek scoped to the pressing pointer |
| `f18eaa6` | 2026-08-06 | fix(cart): stop a hovering mouse from swallowing the first pad click | **M2** | hover must not swallow a pad click |
| `d176dcc` | 2026-08-06 | feat(cart): confirm-tap before a pad fires on touch | **M2** | confirm-tap before a pad fires on touch |
| `f64211e` | 2026-08-06 | fix(playlist): keep set-as-next reachable in Show Mode on a phone | **M2** | set-as-next reachable in Show Mode on a phone |
| `a307503` | 2026-08-06 | fix(ui): make Show Mode per-device again instead of server-synced | **U1 (redesigned)** | per-device Show Mode as an opt-out, not removal |
| `cc8ab5b` | 2026-08-06 | chore(release): 2.5.0 | **FORK-ONLY** | fork version 2.5.0 — collides with upstream 2.5.0 |
| `64a3c71` | 2026-08-08 | feat(x18): touch-first channel level faders in the X18 tab | **X3** | touch-first level faders |
| `6534dd1` | 2026-08-08 | fix(x18): address the fader review — RTL, contrast, focus order, a11y | **X3** | fader review fixes |
| `50740d6` | 2026-08-08 | fix(x18): revive the ± slide-off check, which cleared its own state | **X3** | ± slide-off fix |
| `13959cf` | 2026-08-08 | fix(x18): reclaim the vertical space the faders were actually short of | **X3** | vertical space |
| `b08a54f` | 2026-08-08 | style(x18): merge a duplicated compact rule and correct a stale comment | **X3** | style |
| `c1ec7aa` | 2026-08-08 | feat(server): read the X18 back, not just write to it | **X1** | read the desk back (X18Link) |
| `77a2406` | 2026-08-08 | feat(x18): compose your own faders, synced with the desk | **X3** | compose your own faders |
| `f6ec6dd` | 2026-08-08 | fix(x18): keep a fader under the thumb across a reconnect refresh | **X3** | fader across reconnect |
| `190c383` | 2026-08-08 | fix(x18): the fader editor could not be scrolled or dismissed on a phone | **X3** | fader editor on a phone |
| `06a2dd3` | 2026-08-08 | feat(mobile): drop the output trim, and always open in Show Mode | **M1** | no output trim on phones; open in Show Mode |
| `99544b9` | 2026-08-08 | feat(x18): board buttons that move a fader BY an amount, not TO one | **X1 + X2** | relative moves: server (X1), board UI (X2) |
| `afb6180` | 2026-08-09 | chore(release): 2.6.0 | **FORK-ONLY** | fork version 2.6.0 |
| `bc7ac36` | 2026-08-09 | feat(x18): a mute button beside every level, synced with the desk | **X1 + X3** | mute addresses (X1), mute buttons (X3); version bump FORK-ONLY |

Count by first-listed target: C1 3, DONE 3, DROP 15, E1 2, FORK-ONLY 18, M1 13, M2 5, M3 1, OBSOLETE 1, OPTIONAL 3, S1 4, SUPERSEDED 2, T1 3, T2 2, U1 3, W1 3, W2 14, W3 1, X1 7, X2 2, X3 8

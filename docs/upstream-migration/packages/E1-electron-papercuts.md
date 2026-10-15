# E1 — Electron papercuts: Edit menu, dialog start folder, software rendering

| | |
|---|---|
| Upstream PR title | `fix(electron): Edit menu for copy/paste, open dialogs in Documents/LivePlay, opt-in software rendering` |
| Branch (in the fork) | `up/E1-electron-papercuts` |
| Base | upstream target branch |
| Depends on | nothing |
| Size | ~100 lines in `client/electron/main.js` + menu label keys |
| Fork sources | `72f8534` (Edit menu), `66899a3` (main.js dialog-default part only), `180e772` (software rendering) |
| Risk | Low |

Three independent commits in one PR. Upstream v2.5.1 has none of them
(`grep` finds no `role: 'copy'`, no `disableHardwareAcceleration`, and dialogs
pass only a file name as `defaultPath`).

## 1. `fix(electron): add an Edit menu so copy/paste work on macOS`

On macOS, Cmd+C/V/X/A/Z in text fields only work when the application menu
has an Edit menu with the standard roles. Upstream has none, so you cannot paste
a server address or a cue name.

- In upstream's menu template in `main.js` (search `Menu.buildFromTemplate`),
  add after the File menu:
  `{ label: t.edit, submenu: [ {role:'undo',label:t.undo}, {role:'redo',label:t.redo}, {type:'separator'}, {role:'cut',label:t.cut}, {role:'copy',label:t.copy}, {role:'paste',label:t.paste}, {role:'selectAll',label:t.selectAll} ] }`.
  Copy the exact block from the fork (`git show 72f8534`).
- The labels come from upstream's `menuTranslations` table (`main.js` ~L2393),
  built from each locale's `menu.*` section with English fallbacks. Add seven
  entries the way the fork did (fork `main.js` ~L2269-2275), e.g.
  `edit: data.menu.edit || 'Edit'`, and likewise `undo`, `redo`, `cut`, `copy`,
  `paste`, `selectAll`. Add the `menu.*` keys to `en.json`/`de.json`, then run
  `node scripts/sync-locale-keys.js`.

## 2. `fix(electron): open file dialogs in Documents/LivePlay, then where you last were`

Dialogs without a directory open at `/` when the app is started from Finder or
a desktop launcher.

- Copy `liveplayDocumentsDir()`, `defaultDialogDir()`, `defaultSavePath()`
  and `rememberBrowseDir()` from the fork (`origin/main` `client/electron/main.js`
  ~L28-81). In the comment, replace "counterpart to the server's filesystem
  sandbox" with "matches the default project location".
- In every `dialog.showOpenDialog` / `showSaveDialog` call in upstream `main.js`:
  - open dialogs: `defaultPath: defaultDialogDir()`;
  - save dialogs: `defaultPath: defaultSavePath(<the file name upstream passes today>)`,
    e.g. `defaultSavePath(defaultName || 'project.lpa')`;
  - after a successful pick: `rememberBrowseDir(result.filePaths?.[0] ?? result.filePath)`.

  Use the fork's 7 call sites (`grep -n defaultDialogDir`) as a checklist and
  map each to upstream's equivalent dialog.
- If upstream already has a "default projects folder" concept (PR #35 "welcome
  recent projects default folders"), use **that** folder instead of
  `Documents/LivePlay`, and say so in the PR.

## 3. `feat(electron): LIVEPLAY_DISABLE_GPU=1 for machines without a usable GPU`

Copy the 11-line block from `180e772` to the top of `main.js` (before
`app.whenReady`). It has no effect unless the env var is set. Document it in
`docs/DEVELOPMENT.md` or the README troubleshooting section, one line:
"Headless/VM Linux: start with `LIVEPLAY_DISABLE_GPU=1` if Electron's GPU
process crashes."

## Verification

- macOS: paste a URL into the remote server field with Cmd+V. The Edit menu
  shows translated labels after switching the language to German.
- Open project, open audio, export and save: the first dialog opens in
  Documents/LivePlay, the next one where you left off.
- `LIVEPLAY_DISABLE_GPU=1 npm run dev` on a Linux VM starts without GPU-process
  crashes.

## Done when

- [ ] Three commits. `window-bounds-tests.js` still passes (it lifts functions
      from main.js by name, so do not rename its functions).

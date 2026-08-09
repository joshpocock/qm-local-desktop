# QM Local

**QM Local** is an unofficial desktop shell for the web UI of `qm-local` — a
fork of an open-source agent harness. It's a branded window and tray icon
wrapped around a localhost web app; it doesn't run or contain any agent
logic itself.

This project is **unofficial and not affiliated with, endorsed by, or
sponsored by Y Combinator**. "QM Local" is an independent wrapper built by
its own author; no Y Combinator names, logos, or marks are used anywhere in
this app.

## What it does

- Opens a window pointed at your local `qm-local` web UI (default
  `http://localhost:8291`, the portal, which is the sign-in front door).
- If the stack isn't running, shows a friendly offline screen with a Retry
  button, and polls every 5 seconds so the window loads automatically as
  soon as the server comes up.
- Lives in the system tray: Open, Reload, "Start on login" toggle, and
  Quit. Closing the window minimizes it to the tray instead of exiting.
- Links to a different origin (external links) open in your default
  browser instead of inside the app window.
- The UI address is configurable from **File → Settings...** in the app
  menu, or via the "Settings" button on the offline screen.
- Checks GitHub Releases for a new version on launch and every 6 hours
  after that, and offers to restart and install when one's ready. See
  **Auto-update** below.

## Requirements

- Windows 10/11
- Node.js 22.x
- A running `qm-local` stack (started separately, e.g. via `qm up`) if you
  want to see live content instead of the offline screen.

## Dev commands

```bash
npm install       # install dependencies
npm start          # launch the app (electron .)
npm run icon       # regenerate assets/icon.png from scripts/make-icon.js
npm run dist        # build a portable Windows .exe via electron-builder
```

`npm run dist` produces two unsigned x64 artifacts in `release/`, no code
signing:

- `QM-Local-Desktop-Setup-<version>.exe` — an NSIS installer (per-user,
  no admin required). This is the build that auto-updates; install from
  this one if you want the app to keep itself current.
- `QM-Local-Desktop-<version>-portable.exe` — the old single-file
  portable build. No installation, but also **no auto-update** — see
  below.

## Configuration

The configured UI URL is stored as JSON at:

```
%APPDATA%\qm-local-desktop\config.json
```

Example:

```json
{
  "url": "http://localhost:8291"
}
```

Delete this file (or edit it directly) to reset to the default URL. The
app also validates and rewrites it whenever you save changes from the
Settings window.

## Auto-update

The app uses [`electron-updater`](https://www.electron.build/auto-update)
against this repo's GitHub Releases (`publish` block in `package.json`,
provider `github`, owner `joshpocock`, repo `qm-local-desktop`).

- On launch (once the main window exists) and every 6 hours after that,
  it silently checks GitHub Releases for a newer version and downloads
  it in the background.
- When a download finishes, a dialog offers **Restart now** / **Later**.
  Choosing Later is fine — the update installs automatically the next
  time you quit the app, so you're never force-restarted.
- **File → Check for updates...** triggers a check on demand and tells
  you if you're already up to date.
- A failed check (offline, no releases yet, GitHub unreachable, etc.) is
  logged to the console and otherwise ignored — it never shows an error
  dialog or interferes with loading the qm-local web UI.

### Portable build does not auto-update

`electron-updater` only supports auto-install on Windows through the
**NSIS** target — there's no installed location for it to update in
place for the **portable** target, so `electron-builder` doesn't support
it and the portable `.exe` will never offer or install updates on its
own. That's why `npm run dist` now also builds an NSIS installer
alongside the portable exe: install from the NSIS build
(`QM-Local-Desktop-Setup-<version>.exe`) if you want auto-update.
Anyone running the portable build has to grab new versions manually from
the [Releases page](https://github.com/joshpocock/qm-local-desktop/releases).

### Cutting a release

Auto-update reads GitHub Releases, so a version only becomes available
to installed apps once it's published there with the right artifacts
attached.

1. Bump `"version"` in `package.json` (must be a valid semver higher
   than the last published release — electron-updater compares
   versions, not tags).
2. Commit the bump, tag it to match (e.g. `v1.1.0`), and push both:
   ```bash
   git tag v1.1.0
   git push origin main --tags
   ```
3. Build and publish in one step with a GitHub token that has `repo`
   scope for this repository, set as `GH_TOKEN` in the environment (do
   **not** hardcode it anywhere in this repo):
   ```bash
   GH_TOKEN=ghp_xxx npx electron-builder --publish always
   ```
   This builds both artifacts, generates the `latest.yml` update feed
   metadata, and creates/updates the GitHub Release for the tag with all
   of it attached (the installer, the portable exe, the blockmap, and
   `latest.yml`). `latest.yml` is what installed apps poll — if it's
   missing or stale on the release, auto-update silently finds nothing
   new.
4. Plain `npm run dist` (no `GH_TOKEN`, no `--publish`) still works for
   local builds/testing and never attempts to publish anything.

## Security notes

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on
  every window.
- No Node/Electron `remote` module is used.
- A minimal `preload.js` exposes only four functions (`getConfig`,
  `setConfig`, `retry`, `openSettings`) to the offline/settings pages via
  `contextBridge` — nothing is exposed to the remote qm-local web content
  itself.

## Icon

`assets/icon.png` is an original placeholder: a dark rounded square with a
blocky "QM" monogram, generated by `scripts/make-icon.js` (a small,
dependency-free script that hand-encodes a PNG). It is not based on any
existing product's logo or branding.

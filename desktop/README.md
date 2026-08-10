# warden desktop — the one-click app

A native app (`.exe` / `.dmg` / `.AppImage`) that bundles Node, so a user
double-clicks and gets the warden dashboard in a window — **no terminal, no
npm, no Node install.** It boots the same agent worker + dashboard as the CLI and
shares the same home (`~/.warden`), so it's fully interchangeable with
`npm i -g warden`.

## How it works

Electron ships its own Node runtime. On launch, `main.js`:
1. shows a splash,
2. spawns the dashboard (`next start`) + agent worker (`tsx`) using Electron-as-Node,
3. waits for `127.0.0.1:3100`,
4. loads it in a native window.

The `warden` npm package is a dependency, so `npm install` pulls the **prebuilt**
dashboard, the worker source, and every dep into `node_modules`. Nothing is fetched
at runtime.

## Run it in dev

```bash
cd desktop
npm install        # pulls electron + the local warden (builds its dashboard once)
npm start          # opens the app window
```

## Build the installers

```bash
cd desktop
npm run dist:win     # → dist/warden Setup <v>.exe   (run on Windows)
npm run dist:mac     # → dist/warden-<v>.dmg          (MUST run on macOS)
npm run dist:linux   # → dist/warden-<v>.AppImage
```

Cross-OS note: you can build the Windows `.exe` on Windows and the Linux
`.AppImage` anywhere, but a **`.dmg` must be built on a Mac** (or macOS CI).

## Before you ship (required, or users get scary warnings)

Icons — add these (electron-builder needs them):
- `build/icon.ico` (Windows, 256×256+)
- `build/icon.icns` (macOS)
- `build/icon.png` (Linux, 512×512) — already regenerated from the warden logo; still need `icon.ico`/`icon.icns` for Windows/macOS.

**Code signing** — unsigned installers are the #1 reason a "one-click app" scares
users off:
- **Windows:** an unsigned `.exe` triggers SmartScreen ("Windows protected your
  PC"). Sign with an EV/OV cert: set `CSC_LINK` (path to `.pfx`) + `CSC_KEY_PASSWORD`
  and electron-builder signs automatically.
- **macOS:** an unsigned/un-notarized `.dmg` is **blocked** by Gatekeeper on modern
  macOS. You need an Apple Developer ID cert ($99/yr): sign via `CSC_LINK`/
  `CSC_KEY_PASSWORD` and notarize via `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
  `APPLE_TEAM_ID`.

The cleanest path to signed builds for both OSes is a GitHub Actions release
workflow (win runner + mac runner) with the certs stored as secrets — say the word
and I'll add it.

## Notes / knobs

- Data home is `~/.warden` (shared with the CLI). Change `HOME` in `main.js` to
  isolate the app's data instead.
- Port is `3100`. If it's taken, the app waits and times out — make it configurable
  if you expect conflicts.
- `asar: false` keeps Next/tsx happy (they read files from disk). The installer is
  larger (~200–300 MB) because it bundles Node + all deps — that's the tradeoff for
  "nothing to install."
- **`electron` must stay >=35** (found live, 2026-08-10, running `npm start`): the
  worker uses the built-in `node:sqlite` module, which doesn't exist before
  Node 22.5. Electron 33/34 still bundle Node 20 — the worker child process
  throws `ERR_UNKNOWN_BUILTIN_MODULE` on launch and exits immediately. Electron
  35 is the first release that bundles Node 22 (22.14.0). Don't downgrade below
  35 without also checking what Node version that release bundles.
- Verified end-to-end 2026-08-10: `npm install` + `npm start` actually launches —
  confirms the file:.. -> `warden` package resolution fix (main.js's
  `wardenRoot()`) works, not just that it typechecks. Both child processes
  (dashboard, worker) reach their real startup code; the worker gets past
  module resolution and into `worker/src/index.ts` itself before needing a
  live grant/settings to do anything further.

# Developer guide

How MySecrets is built, where each thing lives, and how to run, test and ship
it. For workflow and pull requests see [CONTRIBUTING](CONTRIBUTING.md); for the
security model see [SECURITY](../user/SECURITY.md).

## Overview

One encrypted vault file (`secrets.enc`) used by four clients:

```
                ┌──────────────────────── desktop app (Electron) ────────────────────────┐
                │  main process: src/main.js + src/main/*      renderer: src/renderer/*   │
                │  shared logic: src/lib/*  (pure Node, unit-tested)                      │
                └───────┬──────────────────────┬──────────────────────┬─────────────────┘
                        │ spawns (127.0.0.1)   │ Google Drive API     │ Wi-Fi (HMAC)
        ┌───────────────┴──────┐        ┌──────┴───────┐       ┌──────┴────────────┐
        │ MCP server            │        │ secrets.enc  │       │ Android app        │
        │ mcp-server/*          │        │ in "MySecrets"│◄─────►│ android/ (Kotlin)  │
        └───────┬───────────────┘        └──────────────┘       └────────────────────┘
                │ HTTP + token
        ┌───────┴──────────────┐
        │ Chrome extension      │   AI clients (Claude Code…) use the MCP server
        │ chrome-extension/*    │   over stdio (mcp-server/index.js)
        └──────────────────────┘
```

## Where things live

### Desktop main process

| File | Responsibility |
|---|---|
| `src/main.js` | Vault core: session, read/write, folder sync, backups, window and menu, app lifecycle, IPC for data |
| `src/main/mcp.js` | Starts/stops the MCP server; extension pairing and "save login"; agent write requests (queue + confirmation) |
| `src/main/gdrive.js` | Google Drive sign-in and sync scheduling (the algorithm is in `src/lib/gdrive-sync.js`) |
| `src/main/phone.js` | Approve PC unlock from the Android phone |
| `src/main/windows-hello.js` | Windows Hello via PowerShell/WinRT |
| `src/main/tray.js` | Tray icon, global shortcut, lock on suspend/screen lock |
| `src/main/updater.js` | electron-updater (GitHub Releases) |

Modules in `src/main/` receive what they need from `main.js` through
`register({ getWindow, … })` instead of reading globals.

### Shared logic (`src/lib/`, pure Node)

| File | Responsibility |
|---|---|
| `vault-crypto.js` | AES-256-GCM vault format, legacy v1, iteration limits, derived-key cache |
| `session-crypto.js` | `.session` encryption (app and MCP) |
| `otp.js` | TOTP/HOTP (app and MCP) |
| `vault-sync.js` | Per-entry merge, deletion records (tombstones), sync folder |
| `gdrive-sync.js` | One Google Drive sync round (no lost deletions or edits, optimistic upload) |
| `google-drive.js` | OAuth (PKCE, loopback) and Drive REST client |
| `phone-link.js` | Phone pairing/unlock protocol |
| `vault-backup.js` | Checks a backup before importing |
| `agent-queue.js` | Queue of agent write requests |

`vault-crypto.js`, `session-crypto.js` and `otp.js` are also loaded by the MCP
server, so they are listed in `build.asarUnpack` (stdio clients run them with the
system `node`, outside the asar).

### Renderer (`src/renderer/`)

Classic scripts, no bundler, loaded in order by `index.html` and sharing the
global scope:

- `app/00-util.js` … `app/15-celular.js`: the UI, split by area (state and
  settings, login, list, entry details, form, 2FA panel, import, actions,
  phone). A function called **while the scripts load** must be declared in the
  same file or an earlier one (hoisting only works inside a file).
- `a11y.js`: dialogs, focus trap, labels for icon buttons.
- `agent-write.js`, `proton-pass-import.js`: confirmation of agent writes,
  Proton Pass import.
- `preload.js` (in `src/`): the only bridge to the main process
  (`window.electronAPI`).

Rule: anything that comes from the vault is passed through `escapeHtml()` before
it reaches `innerHTML`. ESLint enforces this.

### MCP server (`mcp-server/`)

`core.js` (tools and JSON-RPC), `vault.js` (reads the vault through the
session), `files.js` (attachments), `http-server.js` (local HTTP, started by the
app) and `index.js` (stdio, started by the AI client; writes are forwarded to the
app for confirmation).

### Chrome extension (`chrome-extension/`)

Manifest V3. `background.js` talks to the app's HTTP server; `match_url` decides
which logins belong to the page; `content.js` fills forms and offers to save
logins; `popup.js` is the toolbar popup.

### Android (`android/`)

Kotlin + Compose: `vault/` (file and merge), `crypto/` (format, Keystore,
biometrics), `drive/` (Google sign-in and sync), `autofill/`, `link/` (approve
PC unlock), `otp/`, `ui/`.

## Running

Requirements: Node.js 22, npm; for Android, JDK 17 and the Android SDK.

```bash
npm ci
npm start            # run the app
npm run dev          # run with --dev (DevTools enabled)
```

Optional: Google sign-in needs `src/google-oauth.json` (`clientId`,
`clientSecret`), which is git-ignored and created by CI from secrets.

## Tests

```bash
npm test             # unit tests (node:test): crypto, sync, MCP, extension, preload…
npm run lint         # ESLint
npm run test:e2e     # real Electron app with a throwaway profile, driven over CDP
                     # (Linux without a display: xvfb-run -a npm run test:e2e)
make test-android    # Android unit tests (Gradle)
```

- Unit tests live in `tests/*.test.js`; end-to-end tests in `tests/e2e/`.
- The e2e tests never touch your real vault: each run uses a new temporary
  profile.
- Add a test with every fix; where possible, check that it fails without the fix.

## Building and releasing

```bash
npm run build-linux  # AppImage, deb, tar.gz (x64, arm64)
npm run build-win    # NSIS installer and portable (x64)
```

Releases are built by GitHub Actions (`.github/workflows/build.yml`) when a tag
`vX.Y.Z` is pushed; the tag must match `package.json`. The same workflow builds
the signed Android APK and publishes the extension to the Chrome Web Store when
the secrets are configured. `ci.yml` runs lint, unit, e2e and Android tests,
plus a gitleaks scan, on every push to `master` and on pull requests.

Before tagging: bump `version` in `package.json` (and in
`chrome-extension/manifest.json` when the extension changed), and move the
`Unreleased` section of the [CHANGELOG](CHANGELOG.md) under the new version.

### Code signing (Windows)

Unsigned builds work but show SmartScreen warnings. electron-builder signs when
`win.signtoolOptions` (certificate on a token or cloud HSM) or
`win.azureSignOptions` (Azure Artifact Signing) is configured; see the
[electron-builder docs](https://www.electron.build/docs/features/code-signing/code-signing-win/).

## Debugging

- `npm run dev` opens DevTools for the renderer.
- Main process logs go to the terminal.
- MCP server: `node mcp-server/index.js` speaks JSON-RPC on stdin/stdout; the
  HTTP server answers `GET /health`.

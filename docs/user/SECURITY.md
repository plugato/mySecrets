# Security

How MySecrets protects your vault, what it does **not** protect against, and how
to report a vulnerability. Everything here describes the current code; file
names are given so you can check.

## Supported versions

Only the latest release receives security fixes. The desktop app updates itself
from GitHub Releases; the Android APK is attached to the same release.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private reporting:
**Security → Report a vulnerability** on
[plugato/mySecrets](https://github.com/plugato/mySecrets/security). Include the
version, platform, steps to reproduce and the impact you expect. You will get an
answer before any details are made public.

## The vault file

Everything lives in one file, `secrets.enc`, encrypted on your device. There is
no MySecrets server and no account.

| | Current format (v2) |
|---|---|
| Cipher | AES-256-GCM (authenticated: any change to the file is detected) |
| Key derivation | PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random salt |
| IV | 12 random bytes, new on every write |
| Code | `src/lib/vault-crypto.js` (desktop and MCP), `VaultCrypto.kt` (Android) |

- Files in the old v1 format (AES-256-CBC, 100,000 iterations) are still read
  and are rewritten as v2 on the first unlock.
- The iteration count stored in the file is only accepted between 1,000 and
  10,000,000, so a tampered file cannot freeze the app.
- Desktop and Android are tested against the same test vectors
  (`tests/fixtures/`).
- The master password is never written to disk in plain text. If you forget it,
  the vault cannot be recovered.

## While the vault is open

- **Derived key.** The key derived from your master password is kept in memory
  for the session, so saving does not run PBKDF2 again. It is erased when the
  vault locks.
- **Session file.** While the desktop app is unlocked it writes `.session`
  (permissions 600), which holds the master password encrypted with AES-256-GCM
  under a key derived from `.machine-secret` (also 600, in the same profile
  folder). The MCP server and the browser extension use it to read the vault.
  It expires after 15 minutes without renewal and is deleted when the app locks
  or closes. **Anyone who can read your user profile while the vault is open can
  recover the master password from these two files.**
- **Locking.** Auto-lock after 15 minutes of inactivity (configurable), when the
  computer suspends and when the screen locks. Locking removes the vault from
  the page and clears the clipboard if it still holds something the app copied.
- **Clipboard.** Copied secrets are cleared after 30 seconds (configurable), but
  only if the clipboard still holds that value.

## Desktop app (Electron)

- **Leaked-password check** (Password Health, only when you click it): only
  the first 5 characters of each password's SHA-1 hash are sent to Have I Been
  Pwned; the rest of the comparison happens on your computer.

- Renderer isolated: `contextIsolation`, `sandbox`, no Node.js; a narrow
  `preload.js` API with no generic IPC or file access by path.
- Strict CSP (`script-src 'self'`); vault data is escaped before it reaches the
  page, and ESLint (`no-unsanitized`) rejects new unescaped `innerHTML`.
- New windows, navigation, `<webview>` and browser permissions (camera,
  microphone, notifications…) are always refused. DevTools only with `--dev`.
- Electron fuses: no `NODE_OPTIONS`, no `--inspect`, app loaded only from the
  asar. One instance at a time.
- Password generator uses `crypto.getRandomValues` without modulo bias.
- Importing a backup checks that the file is a MySecrets vault, warns if it uses
  another master password and keeps the current vault in `backups/`. Automatic
  backups: at most every 6 hours, last 14 kept.
- Windows Hello: the master password is stored in `hello.enc` with the system
  keychain (`safeStorage`/DPAPI) and released only after Windows Hello confirms.
  Where `safeStorage` is unavailable (e.g. WSL without a keyring) a weaker
  machine-derived key is used instead.

## Sync (Google Drive)

- Only the encrypted `secrets.enc` and a list of deleted entry **ids** (no
  content) are uploaded. Without the master password, Google cannot read them.
- OAuth with PKCE and the `drive.file` scope: the app only sees files it created.
  The refresh token is stored with `safeStorage`.
- Merging is per entry; a failed download or an unreadable deletion list stops
  the sync instead of losing data, and uploads re-check that the cloud copy did
  not change in the meantime.

## Browser extension

- No copy of the vault in the browser: it asks the desktop app, over
  `127.0.0.1` only, with a token obtained through pairing (approved in the app).
- A login is offered only on its own site: same host or same registrable
  domain per the Public Suffix List (`hub.com` never gets the `github.com`
  login; `a.github.io` and `b.github.io` are different sites). Logins saved with
  `https` are not filled on `http` pages.
- Before filling, the extension re-reads the tab and refuses if it navigated
  elsewhere. Passwords are never written to the page console.
- The extension can only call the tools autofill needs: it cannot list or
  search the whole vault or touch attachments.

## AI assistants (MCP server)

- Local only (`127.0.0.1`), bearer token, timing-safe comparison; requests
  from web pages are refused (`Origin` check).
- **Reading needs no confirmation.** While the vault is open, a connected MCP
  client can read any credential, OTP code or attachment. Only connect clients
  you trust, and remember that an assistant can be manipulated by content it
  reads (prompt injection).
- **Writing always asks you** in the app (`store_secret`, `store_secret_file`).
- `get_secret_file` never overwrites a file without keeping a `.bak` copy and
  refuses symbolic links.

## Android app

- Same vault format; biometric unlock with a key in the Android Keystore that
  requires authentication on every use and is invalidated when fingerprints
  change.
- Screens are protected from screenshots (`FLAG_SECURE`), app backup is off and
  copied secrets are marked as sensitive.
- Autofill trusts the web domain only from known browsers; native apps must
  match the site's reversed domain (`com.netflix.*` for `netflix.com`).
- "Approve PC login": requests are signed with a per-PC secret (HMAC-SHA256),
  carry a nonce and must be within 5 minutes; the phone only answers devices on
  the local network.

## What MySecrets does not protect against

- Malware or another person running as your user while the vault is open
  (keyloggers, reading `.session` and `.machine-secret`, screen capture).
- A compromised operating system or browser.
- A weak or reused master password: anyone with `secrets.enc` can try to guess
  it offline.
- What you allow an MCP client to read.
- Losing your master password: there is no recovery.

## For developers

See the [developer guide](../developer/DEVELOPER_GUIDE.md). Security-relevant
rules: escape everything that comes from the vault, keep IPC handlers narrow,
never log secrets, add a test for every fix. CI runs ESLint, the test suites,
CodeQL and a gitleaks secret scan.

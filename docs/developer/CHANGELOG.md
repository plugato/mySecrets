# Changelog

All notable changes to MySecrets will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Dependencies (replaces the open Dependabot PRs, which failed CI): otplib 12 → 13, ESLint 10, GitHub Actions to their current majors, and on Android AGP 9.5.1, Gradle 9.8.2, compileSdk 37, core-ktx 1.19.1, Compose BOM 2026.09.00, Kotlin Compose plugin 2.4.21 and coroutines 1.11.0.
- 2FA secrets pasted the way sites show them (lowercase, spaces, hyphens, trailing `=`) are now accepted.

### Fixed
- Upgrading otplib alone would have broken 2FA codes for 80-bit secrets (16 base32 characters, common on real services): otplib 13 rejects secrets under 128 bits by default. The minimum is relaxed in `src/lib/otp.js`, and the OTP tests now check against an independent RFC 4226/6238 implementation instead of otplib itself.
- ESLint 10's new rules found errors re-thrown without their original cause (now passed as `cause`) and assignments that were never read.

## [2.1.1] - 2026-11-06

### Fixed
- CI: the extension `_locales` check failed on Windows because git checks files out with CRLF there; the comparison now ignores line endings. Because of this, 2.1.0 was tagged but never published; 2.1.1 is the first release with the changes below.

## [2.1.0] - 2026-11-06

### Added
- Android app in English and Portuguese (`values/` and `values-en/`, 196 strings), including errors, dialogs, autofill and the page shown after Google sign-in. On Android 13+ the language can be chosen per app in the system settings (`locales_config`); devices that already had a vault are pinned to Portuguese on first run, new installs follow the system. A unit test checks that both languages have the same keys and arguments.
- Browser extension in English and Portuguese, following the browser's language (`_locales/`). `_locales/pt_BR` is generated from the code (`scripts/extension-locales.js`; a test fails if it is out of date or an English text is missing).
- Desktop app in English and Portuguese (Settings → Language: automatic, Português (Brasil) or English), including dialogs, menus, tray and dates. Portuguese text is the key and `src/locales/en.json` holds the translations; tests check that every string in the code and the page has a translation and that none is left unused. Existing installs stay in Portuguese; new installs follow the system language.
- Browser extension now also runs on Firefox 140+ with the same code and manifest (`background.scripts` next to `service_worker`, Gecko id, no data collection declared). `make ext-firefox` builds the package to sign on addons.mozilla.org. End-to-end tests install the extension in real headless Firefox (WebDriver BiDi) and Chromium (Chrome for Testing) against a fake app and check pairing, the autofill button and filling.
- Desktop: "Senhas vazadas" in Password Health checks your passwords against Have I Been Pwned when you click "Verificar vazamentos". Only the first 5 characters of each password's SHA-1 hash leave the computer (k-anonymity, with padding); the comparison happens in the app and results are kept only in memory until the vault locks.

### Removed
- `native-host/` (Chrome Native Messaging host): unused since the extension talks to the app's local server; it also had a third copy of the vault crypto and hard-coded paths.
- Stray scripts `test-*.js` at the repo root and the outdated `mySecrets-extension.zip`. `make test` now runs `npm test`; `make test-android` runs the Android unit tests; `make ext-pack` writes to `dist/`.

### Security
- Desktop: the password generator used `Math.random()`, which is not cryptographically secure. It now uses `crypto.getRandomValues` with rejection sampling, so every character has the same probability (no modulo bias). Covered by `tests/password-generator.test.js`, including a chi-square uniformity check. Length is capped at 1024. Removed the unused `src/preload-test.js`, which still had the old generator.
- Desktop (Electron hardening): renderer sandbox set explicitly; new windows, navigation and `<webview>` are always refused (the old navigation filter compared the origin with `'file://'`, but a `file:` origin is `"null"`); browser permissions (camera, microphone, notifications…) are denied; only one instance runs at a time (a second launch focuses the first: two instances fought over the vault file and the MCP port); Electron fuses turn off `NODE_OPTIONS` and `--inspect` and only load the app from the asar (`runAsNode` stays on for the MCP server).
- Desktop: locking the vault only hid the screen; the entry list, card grid, open entry and 2FA codes stayed in the page, and a copied secret stayed on the clipboard until its timer. Locking now removes them from the page and clears the clipboard if it still holds what the app copied (anything else you copied is left alone).
- Desktop: DevTools could be opened in the installed app from the "Visualizar" menu, exposing the unlocked vault. They are now disabled at the window level (`webPreferences.devTools`) and only available with `--dev`.
- Desktop: vault fields were inserted into the page as raw HTML in several places (import preview, entry ids, type badges, MFA algorithm/digits/period/counter, token type). A crafted entry arriving through import, sync or an agent could inject markup. They are now escaped, and id-based selectors use `CSS.escape`.
- Chrome extension: the content script logged the whole fill message (password included) and the 2FA code to the console of every page. Logs are now off by default and never include values.
- MCP: `get_secret_file` could overwrite any file without leaving a copy and wrote through symbolic links. Overwriting now keeps the previous file as `<file>.bak-<date>` (returned as `backupPath`), symbolic links are refused, writes are atomic, and the Chrome extension token can no longer use the tool.
- Chrome extension: logins were matched to the page by substring (`hub.com` was offered the `github.com` login, any `*.github.io` site got every other tenant's logins, and `https` logins filled `http` pages). Matching now happens in the app with the new MCP tool `match_url`: same host or same registrable domain per the Public Suffix List (`tldts`). The separate 2FA entry is found the same way. Before filling, the extension re-reads the tab and refuses if it navigated elsewhere or the entry is not for that site, and sends only to the top frame. Updating a saved password from the extension is refused by the app if the entry is not for the form's site. Logins without a URL are no longer offered automatically. **The extension now needs an app with `match_url` (this version).**
- MCP: browser clients (requests with an `Origin`, i.e. the Chrome extension) can now only call the tools autofill needs (`vault_status`, `match_url`, `get_credentials`, `get_otp`); listing/searching the whole vault and attachments are refused, and `tools/list` shows only those.
- MCP: the server had its own copies of the session and vault crypto (without the iteration limit) and still accepted a plain-text `.session`. It now uses the app's `src/lib/vault-crypto.js` and the new shared `src/lib/session-crypto.js` (both shipped unpacked for stdio clients), and only accepts the encrypted session.
- Desktop and Android: the PBKDF2 iteration count stored in a vault file is now limited to 1,000–10,000,000. A tampered file (e.g. in Google Drive, the synced folder or a backup) could otherwise freeze the app.
- Android: the PC-unlock listener (port 47653) accepted connections from any network, including mobile data and public IPv6, and started one thread per connection without limit. Connections from outside the local network are now closed without being read, and at most 8 are handled at a time.
- Android autofill: any app could declare a web domain (e.g. a bank's) and be offered that site's login; native apps matched when the package merely contained the site name (`com.evil.netflix`); and sites were compared by guessing the last 2–3 labels. The web domain is now trusted only from known browsers, native apps must start with the reversed domain (`com.netflix.*`), and sites are compared with the Public Suffix List (`a.github.io` ≠ `b.github.io`).
- Android: "Apagar cofre deste celular" kept the paired PCs and their fingerprint key, so the phone could still approve PC logins after the wipe. They are now removed too.
- Desktop: Electron 38 (no longer receiving security fixes) → 45.2.3; electron-builder 26.18, electron-updater 6.8.11; fixed the high-severity `js-yaml` advisory. The remaining `npm audit` items are in build-only tooling (electron-builder's `minimatch`).

### Changed
- Code structure: `src/main.js` (2,600 lines) split into `src/main/` modules (MCP, Google Drive, phone, Windows Hello, tray, updater) and the renderer `app.js` (4,300 lines) into 16 ordered scripts in `src/renderer/app/`. No behaviour change; covered by unit and end-to-end tests, including a new UI-driven e2e test (create vault, add entry, lock, unlock).
- Documentation consolidated: one index (`docs/README.md`); redundant summaries and outdated guides removed (they described the old Native Messaging design); `SECURITY.md` rewritten (it still described AES-CBC) to match the current code, including what MySecrets does not protect against; developer guide rewritten for the new structure; broken links fixed.
- Desktop accessibility: modals are now real dialogs (`role="dialog"`, `aria-modal`, labelled by their title); opening one moves focus inside and traps Tab, closing returns focus to where it was; icon-only buttons and the × close buttons get accessible names; keyboard focus is visible (`:focus-visible`); animations are off with "reduce motion". Text contrast now meets WCAG AA (4.5:1) in all five themes (new `--primary-text` and `--danger-contrast` tokens; `--text-tertiary` adjusted). axe-core reports no WCAG 2 A/AA violations on the main screen in any theme.
- Tooling: ESLint 9 (`npm run lint`) with correctness/security rules and `eslint-plugin-no-unsanitized`, which rejects any new `innerHTML` built from values that did not go through `escapeHtml()` (the 12 existing ones were audited and annotated). Android Lint errors fixed (two screens read `StateFlow.value` during composition and did not update).
- Tests: new end-to-end suite (`npm run test:e2e`, `tests/e2e/`) that drives the real Electron app with a throwaway profile over the Chrome DevTools Protocol: preload password generator, HTML escaping of vault data, saving from a stale screen after a sync, locking clears the page, modal focus + axe-core (WCAG A/AA) in all five themes, and the MCP server started by the app. Runs in CI under `xvfb-run`.
- CI: new `ci.yml` on every push to master and pull request (lint + tests for desktop/MCP/extension, Android unit tests + Android Lint, gitleaks secret scan with `.gitleaks.toml` exceptions for test vectors), `codeql.yml` (weekly + PRs) and Dependabot for npm, Gradle and GitHub Actions. The release build also runs the linter.
- Desktop: the derived vault key is now cached for the session (like the Android app). Saving and syncing no longer run PBKDF2 (600k iterations) on the main process every time (≈70 ms on a fast PC, more on slower ones, freezing the window); writes reuse the session's salt with a fresh IV. Unlocking derives the key asynchronously. The cache is cleared when the vault locks.

### Fixed
- Android: "Sign in with Google" could end in a browser error at `http://127.0.0.1:<port>`. While Chrome was in front, HyperOS/MIUI froze or killed the app, or the sign-in task was cancelled with the screen (vault locked when the screen turned off, Activity recreated), closing the loopback server that receives Google's reply. Sign-in now runs outside the screen (the account is saved even if the screen goes away; tapping again joins the sign-in already in progress) and a foreground service (`dataSync`) keeps the app awake until the browser returns.
- Desktop: TOTP entries with a period other than 30 s (e.g. 60 s) showed wrong codes: the app passed `period` to otplib, which only reads `step`. If otplib failed to load, the app also made up a code from a hash and reported it as valid. App and MCP now share `src/lib/otp.js` (checked against the RFC 6238 test vector); errors are reported, never replaced by a fake code.
- Desktop: the 2FA codes panel and the entry details used the same element ids (`mfa-code-<id>`); with both on screen one of them stopped updating or copied `••••••`. The panel now has its own ids.
- Desktop: when generating a 2FA code failed, the app showed `000000`, which looked like a real code and could be copied. It now shows `ERRO` (not copyable), and a failed HOTP no longer reports an advanced counter.
- Desktop: importing a MySecrets JSON dropped `token` entries.
- MCP: `get_otp`, and `get_credentials`/autofill for logins with linked 2FA, failed with "Expecting options.algorithm … Received totp" for entries without `mfaHash` (the OTP type was used as the hash). They now default to SHA-1.
- Google Drive sync could lose data (desktop and Android):
  - If downloading the list of deleted items failed (even a network blip), it was treated as empty and uploaded over the other devices' list, so deleted items came back. The sync now stops instead; an unreadable list also stops it, and an unreadable local list is kept as a `.corrompido-…` copy instead of being overwritten.
  - Edits and deletions made while a sync was waiting on the network were overwritten (and a deleted entry could come back). The local vault is now read, merged and written in one step right before writing (desktop: no `await` in between; Android: under the vault's edit lock).
  - Two devices uploading at the same time could overwrite each other. Before uploading, the sync re-checks the files in Drive and, if another device uploaded in the meantime, merges again (up to 3 times). Deletions are uploaded before the vault.
  - Desktop: saving from a screen that had not yet reloaded after a sync wrote the stale list and marked the entries that had just arrived from another device as deleted. Deletions are now computed against what the screen loaded, and if the file changed underneath, the app merges and sends the result back to the screen.
  - A network error while downloading the vault was reported as "uses another master password".
  - Android: a new sync request cancelled a sync already in progress.
- Desktop: "Importar Backup" replaced the vault without checking the file. It now refuses files that are not a MySecrets vault, says whether the backup opens with the current master password (and warns clearly when it does not), keeps the current vault in `backups/antes-de-importar-<date>.enc` and swaps the file atomically. "Exportar Backup" with no vault yet now shows an error instead of doing nothing.
- Installed app: MCP clients configured over stdio (`app.asar.unpacked/mcp-server/index.js`, as the README says) could not load `otplib`, so 2FA codes failed with "Cannot find module". The MCP runtime dependencies are now unpacked next to it.
- Import preview showed "undefined" as the badge for token entries.
- The entry list crashed when a token entry had a non-text `tokenType`.

## [2.0.5] - 2026-11-05

### Fixed
- Android: pairing with the PC never got saved on MIUI/HyperOS. After the QR scanner the system recreates the app screen, which cancelled the pairing task before the fingerprint step ("rememberCoroutineScope left the composition"), so the PC kept calling with a QR the phone had "not read". Pairing now runs outside the screen (survives recreation), and if the fingerprint prompt is closed because the screen went away it is shown again when the app is back. The main screen also handles configuration changes itself, so it is recreated less often.

## [2.0.4] - 2026-11-05

### Fixed
- Pairing with the phone: the PC now waits up to 5 minutes (was 2) and shows a live status under the QR code with the phone's actual answer (e.g. the phone read a different QR). The final error says why instead of a generic "não respondeu".
- Android: the pairing dialog shows the phone's IP, whether it is listening on port 47653 and the last request received from a PC (with the reason when refused). Each pairing step is logged (`MySecretsPair`, `LinkServer`), and cancel/errors after reading the QR are shown instead of silently ignored.

## [2.0.3] - 2026-11-05

### Fixed
- Android: "Parear com PC" did nothing after reading the QR code. The QR scanner (and the Google login and "save attachment" screens) put the app in the background, auto-lock locked the vault on return and the pairing was cancelled before the fingerprint prompt. Auto-lock now doesn't count time spent in screens the app itself opened.

## [2.0.2] - 2026-11-05

### Fixed
- Android: "Desbloquear com a digital" and "Parear com PC" seemed to do nothing on phones without a fingerprint enrolled. The reason was shown at the top of the (scrolled) settings screen. Messages now also show as a toast, and biometric errors (lockout, no enrollment…) are reported instead of being treated as a cancel.

### Changed
- Android 11+: when no fingerprint is enrolled, the device PIN/pattern/password is accepted for unlocking, pairing and approving the PC login (the fingerprint is still offered first when enrolled).

## [2.0.1] - 2026-11-05

### Fixed
- Android: "Entrar com Google" failed with "Unable to resolve host oauth2.googleapis.com: No address associated with hostname" on Android 15 / MIUI-HyperOS. These systems cut network access for apps in the background, and the token exchange ran while the browser was still in front. The app now waits until it is back in the foreground before exchanging the code, and retries Google and Drive calls on transient network errors.

## [2.0.0] - 2026-11-05

### Added
- **Android app** (`android/`, Kotlin + Jetpack Compose, Android 9+). Same vault format (AES-256-GCM + PBKDF2-SHA256 600k), same Google Drive sync (same OAuth client, folder `MySecrets`, per-entry merge with tombstones) and same entry model as the desktop; fields the app doesn't edit (attachments, custom fields, password history) are preserved. Includes list/search/filters, details with copy and live TOTP/HOTP codes, create/edit (password generator, MFA QR scan), trash, attachment download, fingerprint unlock (Android Keystore, `BIOMETRIC_STRONG`), auto-lock and clipboard clearing.
- **System-wide autofill on Android** (Autofill Service): suggests matching logins in apps and browsers (by web domain or app package), fills username, password and MFA code, unlocks with the fingerprint when locked, "Procurar no MySecrets" to pick any entry, and offers to save/update logins typed in (tag `android`, like the extension's save).
- **Approve desktop login from the phone** (same Wi-Fi, no server): Settings > "Celular Android" pairs via QR code; the login screen gets "Aprovar pelo celular". The PC finds the phone on the local network (last IP, then the /24 subnet, outgoing connections only), both show the same 6-digit code and the phone releases the unlock key only after the fingerprint. The master password is stored on the PC encrypted with a key that only the phone holds (Keystore, biometric-bound), and every message is authenticated with the pairing secret (HMAC-SHA256) and single-use nonces. Protocol in `src/lib/phone-link.js`.
- Releases now include the signed Android APK (`MySecrets-<version>-android.apk`).

### Compatibility
- No vault migration. Compatibility is covered by tests on both sides using shared fixtures in `tests/fixtures/` (vault v1/v2 and pairing protocol vectors).

## [1.10.1] - 2026-11-04

### Changed
- Agent write confirmation is now an in-app modal (above everything, including other modals) instead of the native dialog, which opened behind other windows on Linux. It shows the same summary (never values), "Pedido 1 de N" for queued requests and a countdown. When the window isn't focused the app raises it for 2 s (without pinning it on top), restores it if minimized, flashes it in the taskbar until focused and shows a system notification ("Pedido de gravação no cofre", entry title only); clicking the notification only opens the app. When hidden in the tray, the tray icon gets a red dot, a tooltip and a "Revisar pedido de gravação" menu item.

### Fixed
- False negatives on agent writes: the agent got "O app não respondeu" while the write was still applied later (the 240 s limit in the local server didn't reach the app, the native dialog had no deadline and time waiting in the queue wasn't counted). Each request now has a deadline from its arrival (queue time included); a confirmation after the deadline, a cancelled request (agent disconnected) or a server-side timeout never writes, and the agent gets the real result (`expired`/`cancelled`/`declined`). Timeouts are ordered: app 240 s + 10 s apply < local server 260 s < stdio 275 s.
- The stdio MCP server no longer crashes with `write EPIPE` when the client goes away while a write waits for confirmation: it exits cleanly and cancels the pending request in the app.
- The local server exits when the app process goes away (IPC disconnect) instead of staying orphaned on the port.

## [1.10.0] - 2026-11-04

### Added
- File attachments: an entry can hold one or more files (original name, type, size, sha256, note), up to 1 MB each. The content lives inside the encrypted vault (`entry.attachments[]`, base64), so it uses the same AES-256-GCM file, automatic backups and Google Drive sync. The entry details show the list with "Baixar" (save dialog, file written with mode 600) and remove, plus "Anexar arquivo" (file picker). Search also matches attachment names.
- MCP write tools: `store_secret` (create/update an entry with text fields, custom fields and files) and `store_secret_file` (attach one local file). Each write is sent to the app, which re-checks size and sha256 and shows a native confirmation dialog (create or update, entry title, project/tags, names of changed fields, file names, sizes and sha256 prefix, what gets replaced) before saving. Values are never shown in the dialog or logged. Declining returns `declined: true` to the agent.
- MCP read tool `get_secret_file` saves an attachment to a local absolute path (mode 600, no overwrite unless `overwrite: true`). `get_credentials` now also returns `token`, `customFields` and attachment metadata; listings include attachment metadata and custom field names.
- `project` argument maps to a tag (e.g. `tcg-scanner`) so a project's secrets group together in the sidebar tag filter.
- The stdio MCP server forwards writes to the app's local server, found through the new `<userData>/.mcp-endpoint` file (port, written while the server runs) and the existing `.mcp-token`.

### Security
- Writes only work with the app open and unlocked, go through the app (never written by the MCP process), and are refused for requests carrying an `Origin` header (the browser extension). Requests are queued so only one dialog shows at a time.

### Compatibility
- No vault migration is needed: entries without `attachments` behave as before and the encryption envelope is unchanged (v2). Older app versions open the vault normally but drop attachments of an entry they edit through the form, so update every synced PC.

## [1.9.1] - 2026-11-03

### Fixed
- Windows Hello no longer hangs the login screen. The prompt is now opened with `RequestVerificationForWindowAsync`, tied to the app window, so it always shows in front and focus returns to the app when it closes (previously it could open hidden behind the window, leaving "Aguardando Windows Hello..." stuck for up to 2 minutes, or leave the keyboard unresponsive). The old method remains as a fallback.
- The Windows Hello prompt can be cancelled: the button turns into "clique para cancelar" while waiting, and signing in with the master password closes the pending prompt. Waiting time reduced from 2 minutes to 60 seconds.

## [1.9.0] - 2026-11-03

### Added
- Browser extension (1.5.0) pairs with the app automatically: no more copying the pairing code. The extension asks the local server (new `POST /pair` route) and the app asks the user once whether to allow that extension id; approved ids are remembered in `extension-origins.json` and later connections are silent. The pairing code remains as a fallback (e.g. a port other than 8765). "Desconectar" in the popup stops automatic reconnection until "Conectar ao app" is clicked.

## [1.8.1] - 2026-11-01

### Added
- Releases also submit the browser extension to the Chrome Web Store (API v2, service account), skipping when that manifest version is already published or in review. Needs the `CWS_SERVICE_ACCOUNT_JSON`, `CWS_PUBLISHER_ID` and `CWS_EXTENSION_ID` repository secrets.

## [1.8.0] - 2026-11-01

### Added
- Browser extension (1.4.0) offers to save logins: when a form with a password is submitted on a site that isn't in the vault, a prompt asks "Salvar este login no MySecrets?" (or "Atualizar a senha?" when the saved password changed). Works across the post-login redirect and two-step logins; "Nunca neste site" can be undone from the popup. The password stays in the extension's session memory until the user decides and is saved by the app through the local server (new `mysecrets/save_login` method, forwarded to the app over IPC).

### Fixed
- Google sign-in: if the Google Drive permission checkbox is left unchecked on Google's consent screen, the app now explains it instead of failing every minute with HTTP 403.

## [1.7.0] - 2026-11-01

### Added
- Sign in with Google to sync the vault (Settings > Sync > "Entrar com Google"): no folder or desktop client needed. Uses the Google Drive API with the `drive.file` scope (the app only sees the `MySecrets` folder it creates), OAuth loopback + PKCE in the system browser, and keeps the refresh token protected by the OS keychain (safeStorage). The vault stays local and works offline; the encrypted copy is synced on unlock, a few seconds after each change and every minute, with the same entry-by-entry merge as folder sync. Builds need the `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` repository secrets.

## [1.6.0] - 2026-11-01

### Added
- Vault sync through Google Drive for desktop (or any synced folder): Settings > Sync stores the encrypted vault in a `MySecrets` folder (`secrets.enc`, `backups/`, `LEIA-ME.txt`). Changes made on two PCs are merged entry by entry (latest edit wins), cloud conflict copies are merged and archived, and permanent deletions are tracked so entries don't come back. The app reloads when another PC updates the vault. Session, MCP token and Windows Hello stay local to each PC.

### Planned
- Auto-lock after inactivity
- QR code generation for MFA secrets
- Password strength indicator
- Biometric authentication support
- Browser extension
- Mobile apps (iOS/Android)
- Cloud sync (optional, encrypted)
- Password history
- Secure password sharing
- Custom categories/tags
- Import from other password managers
- Multi-language support
- Custom themes

## [1.5.0] - 2026-11-01

### Added
- Import from Proton Pass: unencrypted export as `.zip`, `data.json` or `.csv`. Logins (with linked 2FA entry when the item has TOTP), notes, cards, identities, aliases, Wi-Fi, SSH keys and custom fields; items in the trash are skipped.
- Automated builds on GitHub Actions for Windows (installer + portable, x64) and Linux (AppImage, deb, tar.gz, x64 + arm64), published to the releases repository when a `v*` tag is pushed.

### Changed
- The code repository is now public, so releases (and auto-update) moved from `plugato/mySecrets-releases` to `plugato/mySecrets`. Installs of 1.4.4 or older still look at the old repository: install 1.5.0 manually once.

### Fixed
- `npm test` now actually runs the test suite (`node --test tests/` treated the folder as a file).

## [1.4.4] - 2026-09-29

### Changed
- The local server starts automatically when the vault is unlocked (option "start the server when the vault is unlocked" is now on by default, and turned on once for existing installs), so the browser extension works without opening the MCP modal.

## [1.4.3] - 2026-09-29

### Fixed
- Keyboard stopped responding after unlocking with Windows Hello (fingerprint) until an Alt+Tab: focus now returns to the app window when the Hello prompt closes.

## [1.4.2] - 2026-09-29

### Changed
- Release to validate Windows auto-update from 1.4.1 (no functional changes).

## [1.4.1] - 2026-09-29

### Fixed
- Extension pairing survives restarts: the local server token is stored in the app profile (`.mcp-token`) instead of being regenerated on every start.
- Extension popup opens the pairing screen when the token is rejected, instead of getting stuck on the error screen.
- In-page fill button fetches password and 2FA at click time (it was filling with the metadata-only list), sits inside the password field so Chrome's password menu no longer covers it, and stays visible after clicks.
- 2FA-only pages (e.g. GitLab's verification step) are detected even when the content script is injected after page load, and the code field is no longer mistaken for the username field.
- Orphaned content scripts after an extension reload stop quietly instead of throwing "Extension context invalidated".
- Windows auto-update: releases now ship the NSIS installer and `latest.yml` that electron-updater needs.

### Changed
- Pairing code shown right below the token in the MCP modal (no longer hidden in a tab).
- Extension icons use the app's padlock.

## [1.4.0] - 2026-09-29

### Added
- Shared password for entries tagged `SSO_BANK`: changing the password of one updates all of them (previous password goes to each entry's history), and a new `SSO_BANK` entry saved without a password inherits the group's.

### Fixed
- Extension autofill fills 2FA on two-step logins and when the MFA is not linked to the login.

## [1.3.0] - 2026-09-16

### Added
- Autofill integration between the Chrome extension and the desktop app. The extension now talks to the app's local server (127.0.0.1, bearer token) instead of Native Messaging, so there is no install script, no hardcoded paths and no extension ID to register.
- Pairing code in the MCP modal (tab "Extensão (autofill)"): one string carrying URL + token, pasted into the extension popup.
- Option "start the server when the vault is unlocked", so autofill works every session without opening the MCP modal.
- Tests for domain matching, pairing-code validation and extension access to the local server.

### Changed
- Extension popup no longer asks for the master password (it never held the vault anyway): it now shows the pairing screen and the logins of the current site.
- Password and OTP are fetched only at fill time — the popup list carries title and username only.
- Extension permissions narrowed: `nativeMessaging` dropped, host access reduced from every site to loopback.
- Stale extension docs about the Native Messaging flow removed.

### Security
- The local server accepts `chrome-extension://` origins (token still required) and keeps rejecting web pages, so a site cannot reach the vault.
- Pairing codes pointing outside loopback are refused.

### Note
- `native-host/` is no longer used by the extension and can be deleted.

## [1.2.1] - 2026-08-24

### Fixed
- Auto-update was broken: the GitHub releases feed returned 404 because the code repository is private. Updates are now published to the public releases-only repository `plugato/mySecrets-releases`.

## [1.2.0] - 2026-08-24

### Added
- Quick copy buttons on grid cards (password, MFA code and token) without opening details
- Logins with a linked MFA get two copy buttons on the card: password and MFA code
- Settings option to enable the global shortcut Ctrl+Shift+M (off by default, registered with a 5s delay)

### Fixed
- System keyboard froze for a few seconds on startup caused by the unconditional global shortcut registration (keyboard grab)

## [1.0.0] - 2024-12-16

### Added
- Initial release
- Secure password storage with AES-256-CBC encryption
- Master password authentication
- TOTP (Time-based One-Time Password) support
- HOTP (Counter-based One-Time Password) support
- Configurable MFA settings (period, digits, hash algorithm)
- API token storage with expiration tracking
- Secure notes
- Password generator with customizable options
- Search functionality
- Category filters (All, Logins, MFA, Tokens, Notes)
- Entry sorting (by title, date, type)
- Light and dark themes
- Backup export to encrypted file
- Backup import with confirmation
- JSON batch import for MFA entries
- Desktop menu integration
- Keyboard shortcuts support
- Auto-clipboard clearing after 30 seconds
- Real-time TOTP code updates with visual timer
- HOTP counter management
- Responsive UI design
- Material Design icons
- Entry count indicators
- Context isolation for security
- No external navigation protection
- PBKDF2 key derivation (100,000 iterations)
- Unique salt and IV per encryption
- Cross-platform support (Windows, Linux)
- AppImage distribution (Linux)
- NSIS installer (Windows)

### Security
- AES-256-CBC encryption for all stored data
- PBKDF2 key derivation with 100,000 iterations
- Unique random salt per vault
- Unique random IV per encryption operation
- Master password never stored
- Context isolation between processes
- No Node.js integration in renderer
- Secure IPC communication via preload script
- No external navigation allowed
- Local-only storage (no cloud)
- Clipboard auto-clearing

### UI/UX
- Modern, clean interface
- Material Design icons
- Smooth animations and transitions
- Dark mode support
- Responsive layout
- Visual feedback for all actions
- Toast notifications for operations
- Progress indicators for MFA codes
- Search with instant filtering
- Category-based navigation
- Entry details panel
- Modal dialogs for forms
- Password visibility toggle
- Confirmation dialogs for destructive actions

### Developer Features
- Electron 38.2.1
- electron-builder for packaging
- Modular code structure
- IPC handlers for all operations
- Comprehensive error handling
- Development mode with DevTools
- Test scripts included
- Clear documentation

## [0.9.0-beta] - 2024-12-01

### Added
- Beta release for testing
- Core encryption functionality
- Basic password storage
- MFA code generation
- Simple UI

### Changed
- Improved encryption algorithm from AES-128 to AES-256
- Increased PBKDF2 iterations from 10,000 to 100,000

### Fixed
- Security vulnerability in key derivation
- Memory leak in MFA timer
- UI rendering issues on small screens

## [0.1.0-alpha] - 2024-11-15

### Added
- Initial alpha release
- Basic Electron app structure
- Password storage prototype
- Simple authentication

---

## Version History Summary

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | 2024-12-16 | First stable release |
| 0.9.0-beta | 2024-12-01 | Beta testing release |
| 0.1.0-alpha | 2024-11-15 | Initial alpha release |

## Breaking Changes

### From Beta to 1.0.0
- None - Full backward compatibility maintained

## Migration Guide

### Upgrading from Beta

1. **Backup your data**:
   ```bash
   # Export from beta version
   File → Export Backup → save as backup-beta.enc
   ```

2. **Install new version**:
   - Follow installation instructions in [INSTALLATION.md](../user/INSTALLATION.md)

3. **Import data**:
   ```bash
   # Import in new version
   File → Import Backup → select backup-beta.enc
   ```

4. **Verify**:
   - Check all entries loaded correctly
   - Test MFA codes
   - Test backup/restore

## Deprecations

None currently.

## Known Issues

### Version 1.0.0

#### High Priority
None

#### Medium Priority
- [ ] Auto-lock not yet implemented
- [ ] No password strength indicator
- [ ] Cannot import from other password managers
- [ ] No multi-language support

#### Low Priority
- [ ] No QR code generation
- [ ] No custom themes beyond light/dark
- [ ] No tags/categories beyond types
- [ ] No password history tracking

#### Workarounds
- **Auto-lock**: Use manual lock button when leaving computer
- **Password strength**: Use external tool to verify password strength
- **Import from others**: Manually enter or create JSON file
- **Languages**: Currently Portuguese/English only in documentation

## Security Advisories

None currently. 

Report security issues to: security@yourdomain.com (not in public issues)

## Detailed Changes by Category

### Security Improvements (1.0.0)

#### Encryption
- Implemented AES-256-CBC (up from AES-256-GCM prototype)
- Added PBKDF2 key derivation with 100,000 iterations
- Unique salt per vault (16 bytes random)
- Unique IV per encryption (16 bytes random)
- Secure key length: 256 bits

#### Architecture
- Enabled context isolation
- Disabled Node.js integration in renderer
- Implemented secure IPC via preload script
- Added navigation prevention
- Added clipboard auto-clearing (30s timeout)

#### Data Protection
- Master password never stored on disk
- All sensitive data encrypted at rest
- Memory cleared after use
- No external network requests
- Local-only storage

### Features Added (1.0.0)

#### Password Management
- Add/Edit/Delete password entries
- Username and URL fields
- Password generator (8-64 characters)
- Symbol inclusion option
- Password visibility toggle
- Notes field for additional info

#### MFA Support
- TOTP implementation via otplib
- HOTP implementation via otplib
- Configurable period (1-300 seconds)
- Configurable digits (6 or 8)
- Multiple hash algorithms (SHA-1, SHA-256, SHA-512)
- Real-time code updates
- Visual progress timer
- Manual counter management for HOTP

#### Token Management
- API token storage
- Token type categorization
- Expiration date tracking
- Long text support (textarea)
- Multiple token types supported

#### UI Features
- Material Design icons
- Dark/Light theme toggle
- Theme persistence
- Responsive layout
- Entry list with filtering
- Category navigation
- Search functionality
- Sort options
- Entry count badges
- Welcome screen
- Loading states
- Error messages
- Success notifications

#### Data Management
- Encrypted backup export (.enc files)
- Encrypted backup import with confirmation
- JSON batch import for MFA entries
- Duplicate detection during import
- Data validation on save/load
- Auto-save on changes
- Vault reset with confirmation

### Performance (1.0.0)

- Fast encryption/decryption (< 100ms typical)
- Real-time search (< 50ms)
- Efficient MFA updates (1s interval)
- Minimal memory footprint (< 200MB typical)
- Quick startup (< 2s)

### Bug Fixes (1.0.0)

- Fixed: TOTP codes not syncing with time
- Fixed: Theme not persisting between sessions
- Fixed: Search not clearing properly
- Fixed: Modal backdrop click not working
- Fixed: Clipboard not clearing properly
- Fixed: Entry details not updating after edit
- Fixed: Filter counts not updating
- Fixed: Password generator symbols option not working
- Fixed: Import not validating JSON properly
- Fixed: DevTools opening in production

### Documentation (1.0.0)

- Comprehensive README in Portuguese and English
- Developer guide with technical details
- Quick start guide for new users
- Installation guide for all platforms
- Changelog with version history
- Contributing guidelines
- Security documentation
- Troubleshooting section

## Roadmap

### Version 1.1.0 (Q1 2025)
- [ ] Auto-lock after configurable inactivity
- [ ] Password strength indicator
- [ ] Password history (last 10 passwords)
- [ ] QR code generation for MFA secrets
- [ ] Import from 1Password, LastPass, Bitwarden
- [ ] Custom entry icons
- [ ] Favorite entries

### Version 1.2.0 (Q2 2025)
- [ ] Browser extension (Chrome, Firefox)
- [ ] Auto-fill for web forms
- [ ] Secure password sharing
- [ ] Team vaults (shared)
- [ ] Advanced search with operators
- [ ] Custom tags/categories
- [ ] Batch operations

### Version 2.0.0 (Q3 2025)
- [ ] Mobile apps (iOS, Android)
- [ ] Cloud sync (optional, E2E encrypted)
- [ ] Biometric authentication
- [ ] Hardware key support (YubiKey)
- [ ] Multi-user support
- [ ] Audit log
- [ ] Security dashboard
- [ ] Breach monitoring

### Long-term (2026+)
- [ ] Self-hosted server option
- [ ] CLI version
- [ ] API for integrations
- [ ] Plugin system
- [ ] Advanced admin features
- [ ] SAML/SSO support

## Contributing

See [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for details on:
- Setting up development environment
- Code structure and architecture
- Adding new features
- Testing procedures
- Submitting pull requests

## Support

- 📖 Documentation: See README.md, QUICK_START.md, DEVELOPER_GUIDE.md
- 🐛 Bug Reports: [GitHub Issues](https://github.com/your-repo/mysecrets/issues)
- 💡 Feature Requests: [GitHub Discussions](https://github.com/your-repo/mysecrets/discussions)
- 🔒 Security Issues: security@yourdomain.com (private)

## License

MIT License - see [LICENSE](../../LICENSE) file for details.

---

**Note**: Dates and version numbers in this changelog are examples. Update with actual release dates.


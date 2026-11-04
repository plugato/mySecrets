# Changelog

All notable changes to MySecrets will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
   - Follow installation instructions in [INSTALLATION.md](INSTALLATION.md)

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

MIT License - see [LICENSE](LICENSE) file for details.

---

**Note**: Dates and version numbers in this changelog are examples. Update with actual release dates.


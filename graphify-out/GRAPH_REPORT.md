# Graph Report - mySecrets  (2026-11-01)

## Corpus Check
- 68 files · ~90,027 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 4, .css 2, .example 1)

## Summary
- 818 nodes · 1372 edges · 40 communities (35 shown, 5 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 111 edges (avg confidence: 0.86)
- Token cost: 298,487 input · 0 output

## Community Hubs (Navigation)
- Renderer DOM & State
- Vault Access Integrations
- jsQR Decoder Core
- Security Policy & Crypto
- Documentation Index
- Electron Main Process
- MCP Vault Reader
- MCP Tool Dispatch
- Extension Manifest
- Entry Views & Rendering
- Makefile & Icon Tooling
- Password Generator & Theme
- Content Script Autofill
- Extension Popup UI
- Changelog & Releases
- Auto-lock & MCP Modal
- Extension Background Worker
- Package Metadata
- Build Config
- Entry Form & Custom Fields
- Contributing Guidelines
- Login & Windows Hello
- Core Security Features
- Run & Build Guides
- Extension Summary Docs
- Preload & Dev Deps
- npm Scripts
- MFA/TOTP Generation
- Galois Field Polynomials
- Native Messaging (Legacy)
- App & Extension Icons
- Electron IPC Architecture
- Import Converters
- Release Publish Config
- Dev Update Config
- Windows Build Target
- Icon Script (full)
- Icon Script (simple)
- Native Host Wrapper
- Chrome Test Script

## God Nodes (most connected - your core abstractions)
1. `setupEventListeners()` - 36 edges
2. `SECURITY.md - Security Policy` - 26 edges
3. `RESUMO_INTEGRACAO.md - Extension + Desktop Integration Summary` - 17 edges
4. `showMainScreen()` - 14 edges
5. `handleSearch()` - 14 edges
6. `renderEntryDetails()` - 14 edges
7. `INSTALLATION.md - Installation Guide` - 14 edges
8. `activeData()` - 12 edges
9. `createGridCard()` - 12 edges
10. `saveEntry()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `MCP Autostart on Unlock` --semantically_similar_to--> `Session File (~/.config/mysecrets/.session)`  [INFERRED] [semantically similar]
  src/renderer/index.html → docs/summaries/RESUMO_INTEGRACAO.md
- `MySecrets desktop app (Electron)` --semantically_similar_to--> `Electron password and MFA manager`  [INFERRED] [semantically similar]
  README.md → .github/copilot-instructions.md
- `make ext-integrate / ext-check` --references--> `install.sh (native host installer)`  [AMBIGUOUS]
  README.md → native-host/README.md
- `MCP tools (vault_status, list_secrets, search_secrets, get_credentials, get_otp)` --semantically_similar_to--> `Host commands (status, get_entries, ping)`  [INFERRED] [semantically similar]
  mcp-server/README.md → native-host/README.md
- `MCP Server Modal` --semantically_similar_to--> `Native Messaging Host (mysecrets-host.js)`  [INFERRED] [semantically similar]
  src/renderer/index.html → docs/summaries/RESUMO_INTEGRACAO.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **External clients access vault only via unlocked app session** — mcp_server_readme_session_file, native_host_readme_session_model, chrome_extension_readme_extension_local_server, mcp_server_readme_http_transport [INFERRED 0.85]
- **Extension pairing and autofill flow** — chrome_extension_popup_pair_screen, chrome_extension_readme_extension_pairing_code, chrome_extension_readme_extension_local_server, chrome_extension_readme_extension_just_in_time_secrets [INFERRED 0.85]
- **Electron security boundary (main/preload/renderer + context isolation)** — docs_developer_developer_guide_main_process, docs_developer_developer_guide_preload_window_api, docs_developer_developer_guide_renderer_process, docs_developer_changelog_context_isolation [EXTRACTED 1.00]
- **Legacy Native Messaging autofill flow** — docs_extension_integracao_extensao_native_messaging_host, native_host_install, docs_extension_integracao_extensao_native_messaging_manifest, docs_extension_integracao_extensao_session_file, docs_developer_developer_guide_secrets_enc, docs_extension_integracao_extensao_url_filtering [EXTRACTED 1.00]
- **Local server pairing/autofill flow** — docs_developer_changelog_local_server_autofill, docs_developer_changelog_pairing_code, docs_developer_changelog_mcp_token_file, docs_privacy_site_index_data_accessed [INFERRED 0.85]
- **Vault Encryption Scheme (PBKDF2 + salt/IV + AES-256-CBC)** — docs_user_security_pbkdf2_sha256, docs_user_security_unique_salt_and_iv, docs_user_security_aes_256_cbc, docs_user_security_encrypt, docs_user_security_decrypt, docs_user_security_key_derivation_process [EXTRACTED 1.00]
- **Chrome Extension to Desktop App Native Messaging Integration** — docs_summaries_resumo_integracao_native_messaging_host, docs_summaries_resumo_integracao_session_file, docs_summaries_resumo_integracao_getentriesfromnativeapp, docs_summaries_resumo_integracao_sendnativemessage, docs_summaries_resumo_integracao_connectnativeapp, docs_summaries_resumo_integracao_url_entry_filtering, docs_summaries_resumo_integracao_pid_verification, docs_summaries_resumo_integracao_com_mysecrets_native_json [EXTRACTED 1.00]
- **Renderer Security Settings Controls** — src_renderer_index_setting_auto_lock, src_renderer_index_setting_clipboard_clear, src_renderer_index_setting_global_shortcut, src_renderer_index_setting_auto_backup, src_renderer_index_reset_confirmation_modal [INFERRED 0.75]
- **Chrome extension icon size set (16/32/48/128)** — chrome_extension_icons_icon16_extension_icon_16, chrome_extension_icons_icon32_extension_icon_32, chrome_extension_icons_icon48_extension_icon_48, chrome_extension_icons_icon128_extension_icon_128 [INFERRED 0.95]

## Communities (40 total, 5 thin omitted)

### Community 0 - "Renderer DOM & State"
Cohesion: 0.02
Nodes (86): addCustomFieldBtn, addEntryBtn, authScreen, AVAILABLE_THEMES, cancelImportBtn, cancelResetBtn, clearSearchBtn, confirmImportBtn (+78 more)

### Community 1 - "Vault Access Integrations"
Cohesion: 0.06
Nodes (46): Local loopback server 127.0.0.1:8765 with bearer token, MySecrets MCP Server README, HTTP transport controlled by app (127.0.0.1:8765/mcp, bearer token), MCP tools (vault_status, list_secrets, search_secrets, get_credentials, get_otp), MYSECRETS_DATA_DIR environment variable, Encrypted .session file (15 min, machine/process bound), stdio transport spawned by client (node mcp-server/index.js), install.sh (native host installer) (+38 more)

### Community 2 - "jsQR Decoder Core"
Cohesion: 0.06
Nodes (37): binarize(), BitMatrix(), BitStream(), buildFunctionPatternMask(), computeDimension(), countBlackWhiteRun(), countBlackWhiteRunTowardsPoint(), decode() (+29 more)

### Community 3 - "Security Policy & Crypto"
Cohesion: 0.05
Nodes (51): Master Password Creation (no recovery), SECURITY.md - Security Policy, AES-256-CBC Encryption, Compliance (OWASP, CWE, NIST), Cryptographic Specifications Table, decrypt(encryptedData, password), Electron Security Guide, encrypt(plaintext, password) (+43 more)

### Community 4 - "Documentation Index"
Cohesion: 0.07
Nodes (42): DOCS_INDEX.md - Documentation Index, Documentation Roadmap, Documentation Learning Paths (Beginner/Developer/Power User), Quick Navigation by Goal ('I want to...'), Bilingual Documentation (PT-BR + EN), Documentation Statistics (~4,900 lines, 9 files), RESUMO_INTEGRACAO.md - Extension + Desktop Integration Summary, Extension Autofill Flow via Native Messaging (+34 more)

### Community 5 - "Electron Main Process"
Cohesion: 0.06
Nodes (46): { app, BrowserWindow, Menu, Tray, ipcMain, dialog, safeStorage, clipboard, nativeImage, globalShortcut, powerMonitor }, applyGlobalShortcut(), backupsDir, checkHelloAvailability(), createSession(), createTray(), createWindow(), crypto (+38 more)

### Community 6 - "MCP Vault Reader"
Cohesion: 0.05
Nodes (34): checkSession(), crypto, decryptSession(), decryptVault(), fs, generateOtp(), generateSessionKey(), loadEntries() (+26 more)

### Community 7 - "MCP Tool Dispatch"
Cohesion: 0.08
Nodes (28): callTool(), dispatch(), findEntries(), publicView(), resolveOtp(), scoreMatch(), SERVER_INFO, TOOLS (+20 more)

### Community 8 - "Extension Manifest"
Cohesion: 0.06
Nodes (34): action, default_icon, default_popup, description, suggested_key, background, service_worker, type (+26 more)

### Community 9 - "Entry Views & Rendering"
Cohesion: 0.14
Nodes (35): activeData(), backToGridView(), computeHealthIssues(), copyToClipboard(), createEntryElement(), createGridCard(), createMFARow(), currentFilterType() (+27 more)

### Community 10 - "Makefile & Icon Tooling"
Cohesion: 0.08
Nodes (27): Copilot Instructions (project setup checklist), Electron password and MFA manager, Makefile Quick Commands reference, Chrome extension make targets (extension, ext-icons, ext-pack, ext-install), make build-linux (AppImage build), make dev (run with DevTools), make test-totp (TOTP/MFA generation test), Makefile workflows (first time, daily dev, release, troubleshooting) (+19 more)

### Community 11 - "Password Generator & Theme"
Cohesion: 0.10
Nodes (23): clearSearch(), closeResetModal(), closeThemeMenu(), computePasswordStrength(), copyGeneratedPassword(), generateNewPassword(), handleMfaQrImageSelect(), handleReset() (+15 more)

### Community 12 - "Content Script Autofill"
Cohesion: 0.25
Nodes (20): detectOnLoad(), fillCustomFields(), fillField(), fillLoginForm(), findLoginForm(), findMfaField(), findPasswordFields(), findUsernameFields() (+12 more)

### Community 13 - "Extension Popup UI"
Cohesion: 0.18
Nodes (18): ask(), autofill(), el(), entries, Error screen (retry, help instructions), initialize(), Entries list screen (search, current site, entries, unpair), loadEntries() (+10 more)

### Community 14 - "Changelog & Releases"
Cohesion: 0.13
Nodes (19): Auto-update via plugato/mySecrets-releases, MySecrets Changelog, Optional global shortcut Ctrl+Shift+M, Keep a Changelog / Semantic Versioning, .mcp-token persistent server token, Pairing code (URL + token), MySecrets roadmap (1.1, 1.2, 2.0), SSO_BANK shared password group (+11 more)

### Community 15 - "Auto-lock & MCP Modal"
Cohesion: 0.18
Nodes (20): closeModals(), copyMFACode(), getSettings(), hideMFAOverview(), isUnlocked(), lockApp(), openMcpModal(), refreshMcpStatus() (+12 more)

### Community 16 - "Extension Background Worker"
Cohesion: 0.29
Nodes (10): entriesForUrl(), fillFirstMatch(), fillTab(), getConn(), handlers, pair(), rpc(), status() (+2 more)

### Community 17 - "Package Metadata"
Cohesion: 0.18
Nodes (11): author, dependencies, electron-updater@^6.8.9, otplib@^12.0.1, description, keywords, license, main (+3 more)

### Community 18 - "Build Config"
Cohesion: 0.17
Nodes (12): build, appId, asarUnpack, directories, files, linux, mac, productName (+4 more)

### Community 19 - "Entry Form & Custom Fields"
Cohesion: 0.24
Nodes (12): addCustomField(), applyOtpauthToForm(), generateCustomFieldId(), handleEntryTypeChange(), handleMfaAlgorithmChange(), loadCustomFields(), openEntryModal(), populateForm() (+4 more)

### Community 20 - "Contributing Guidelines"
Cohesion: 0.22
Nodes (8): Code of Conduct, Contributing to MySecrets, Conventional Commits convention, JSDoc code documentation, Pull request process, Test scripts (test-totp.js, test-methods.js, test-conversion.js), MySecrets Developer Guide, Internationalization (i18n) approach

### Community 21 - "Login & Windows Hello"
Cohesion: 0.25
Nodes (11): autoHelloLogin(), handleHelloLogin(), handleLogin(), handleSetup(), hideError(), offerHelloEnrollment(), purgeExpiredTrash(), showError() (+3 more)

### Community 22 - "Core Security Features"
Cohesion: 0.24
Nodes (6): Clipboard auto-clear after 30s, Encrypted backup export/import (.enc), TOTP/HOTP support via otplib, Release 1.0.0: initial stable release, MFA implementation with otplib, secrets.enc vault file

### Community 23 - "Run & Build Guides"
Cohesion: 0.28
Nodes (9): electron-builder build configuration, Quick commands (COMO_USAR), Entry types (Login, MFA, Token, Secure Note), How to run and build MySecrets (EXECUTAR_PROJETO), npm scripts (dev, start, build, build-linux, build-win, pack), Wine for Windows cross-build, make ext-integrate / ext-check, Make targets (dev, build-linux, status, clean, ext-*) (+1 more)

### Community 24 - "Extension Summary Docs"
Cohesion: 0.31
Nodes (8): Content script login form detection and fill, Extension popup UI, Chrome Extension Summary (MySecrets Autofill), MutationObserver for SPA detection, Native Messaging integration (optional), Comparison vs LastPass/1Password/Bitwarden, Standalone test mode, Extension README (LEIA-ME)

### Community 25 - "Preload & Dev Deps"
Cohesion: 0.22
Nodes (7): devDependencies, electron@^38.2.1, electron-builder@^26.15.3, electron, electron-builder, { contextBridge, ipcRenderer }, { contextBridge, ipcRenderer }

### Community 26 - "npm Scripts"
Cohesion: 0.22
Nodes (9): scripts, build, build-linux, build-win, dev, dist, pack, start (+1 more)

### Community 27 - "MFA/TOTP Generation"
Cohesion: 0.28
Nodes (5): MFA, renderMFACodes(), showMFAOverview(), startMFARowTimer(), startMFATimer()

### Community 29 - "Native Messaging (Legacy)"
Cohesion: 0.48
Nodes (6): Extension + Desktop Integration guide (Native Messaging), Native host mysecrets-host.js, com.mysecrets.native.json manifest, Entries filtered by URL, Manual Native Messaging manifest setup, Integration quick install (INSTALAR_INTEGRACAO)

### Community 30 - "App & Extension Icons"
Cohesion: 0.40
Nodes (6): mySecrets App Icon (padlock on purple gradient), Padlock Brand Identity (white lock, blue-violet gradient rounded square), Chrome Extension Icon 128px, Chrome Extension Icon 16px, Chrome Extension Icon 32px, Chrome Extension Icon 48px

### Community 31 - "Electron IPC Architecture"
Cohesion: 0.47
Nodes (5): Adding a new IPC handler (main -> preload -> renderer), IPC handlers (save-data, load-data, generate-totp, generate-hotp), Main process (src/main.js), Preload script window.api (contextBridge), Renderer process (src/renderer/app.js)

### Community 32 - "Import Converters"
Cohesion: 0.33
Nodes (6): convertBitwardenToMySecrets(), convertExternalToMySecrets(), handleFileSelect(), normalizeImportData(), showImportPreview(), validateImportData()

### Community 33 - "Release Publish Config"
Cohesion: 0.40
Nodes (5): publish, owner, provider, releaseType, repo

### Community 34 - "Dev Update Config"
Cohesion: 0.50
Nodes (3): owner, provider, repo

### Community 35 - "Windows Build Target"
Cohesion: 0.67
Nodes (3): win, icon, target

## Ambiguous Edges - Review These
- `mysecrets-host.js` → `Local loopback server 127.0.0.1:8765 with bearer token`  [AMBIGUOUS]
  chrome-extension/README_EXTENSION.md · relation: semantically_similar_to
- `make ext-integrate / ext-check` → `install.sh (native host installer)`  [AMBIGUOUS]
  README.md · relation: references
- `Session File (~/.config/mysecrets/.session)` → `PBKDF2-SHA256 (100,000 iterations)`  [AMBIGUOUS]
  docs/summaries/RESUMO_INTEGRACAO.md · relation: conceptually_related_to

## Knowledge Gaps
- **57 isolated node(s):** `Copilot Instructions (project setup checklist)`, `make build-linux (AppImage build)`, `Makefile workflows (first time, daily dev, release, troubleshooting)`, `make docs / docs-open / docs-user / docs-dev / docs-ext`, `Security-concerned reading flow` (+52 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 315 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `otplib` connect `Vault Access Integrations` to `Package Metadata`, `MCP Vault Reader`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 27 inferred relationships involving `setupEventListeners()` (e.g. with `addCustomField()` and `clearSearch()`) actually correct?**
  _`setupEventListeners()` has 27 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Copilot Instructions (project setup checklist)`, `make build-linux (AppImage build)`, `Makefile workflows (first time, daily dev, release, troubleshooting)` to the rest of the system?**
  _57 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Renderer DOM & State` be split into smaller, more focused modules?**
  _Cohesion score 0.023255813953488372 - nodes in this community are weakly interconnected._
- **Why does `RESUMO_INTEGRACAO.md - Extension + Desktop Integration Summary` connect `Documentation Index` to `Security Policy & Crypto`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `mysecrets-host.js` and `Local loopback server 127.0.0.1:8765 with bearer token`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `make ext-integrate / ext-check` and `install.sh (native host installer)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
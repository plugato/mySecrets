# Graph Report - mySecrets  (2026-11-04)

## Corpus Check
- 69 files · ~115,281 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: (none) 5, .css 2, .example 1)

## Summary
- 1137 nodes · 1999 edges · 67 communities (62 shown, 5 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 162 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c8174b1c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Renderer DOM & State
- Vault Access Integrations
- jsQR Decoder Core
- Security Policy & Crypto
- Documentation Index
- main.js
- vault.js
- MCP Tool Dispatch
- Extension Manifest
- Entry Views & Rendering
- Documentation Index (INDEX.md)
- Password Generator & Theme
- Content Script Autofill
- Extension Popup UI
- Changelog & Releases
- Auto-lock & MCP Modal
- background.js
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
- google-drive.js
- App & Extension Icons
- INSTALLATION.md - Installation Guide
- escapeHtml
- Release Publish Config
- Dev Update Config
- attachments.test.js
- Icon Script (full)
- Icon Script (simple)
- Native Host Wrapper
- Chrome Test Script
- proton-pass-import.test.js
- vault-sync.js
- vault-sync.test.js
- vaultFile
- files.js
- runGdriveSync
- MySecrets README
- vault-crypto.test.js
- publish-chrome-extension.test.js
- test-host.js
- index.js
- publish-chrome-extension.js
- encryptSession
- agent-write.js
- steps
- with
- processAgentWrite
- build
- jobs
- env
- ref_fs
- startMcpServer
- release
- ref_crypto
- linux
- sendLockToRenderer
- chrome-web-store

## God Nodes (most connected - your core abstractions)
1. `setupEventListeners()` - 37 edges
2. `SECURITY.md - Security Policy` - 28 edges
3. `Documentation Index (INDEX.md)` - 26 edges
4. `MySecrets README` - 23 edges
5. `handleSearch()` - 18 edges
6. `RESUMO_INTEGRACAO.md - Extension + Desktop Integration Summary` - 18 edges
7. `renderEntryDetails()` - 17 edges
8. `INSTALLATION.md - Installation Guide` - 16 edges
9. `persistData()` - 14 edges
10. `showMainScreen()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `MCP Autostart on Unlock` --semantically_similar_to--> `Session File (~/.config/mysecrets/.session)`  [INFERRED] [semantically similar]
  src/renderer/index.html → docs/summaries/RESUMO_INTEGRACAO.md
- `make ext-integrate / ext-check` --references--> `install.sh (native host installer)`  [AMBIGUOUS]
  README.md → native-host/README.md
- `MCP tools (vault_status, list_secrets, search_secrets, get_credentials, get_otp)` --semantically_similar_to--> `Host commands (status, get_entries, ping)`  [INFERRED] [semantically similar]
  mcp-server/README.md → native-host/README.md
- `MySecrets desktop app (Electron)` --semantically_similar_to--> `Electron password and MFA manager`  [INFERRED] [semantically similar]
  README.md → .github/copilot-instructions.md
- `Windows Hello Login Button` --semantically_similar_to--> `Future Security Improvements (Argon2id, YubiKey, auto-lock)`  [INFERRED] [semantically similar]
  src/renderer/index.html → docs/user/SECURITY.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Electron security boundary (main/preload/renderer + context isolation)** — docs_developer_developer_guide_main_process, docs_developer_developer_guide_preload_window_api, docs_developer_developer_guide_renderer_process, docs_developer_changelog_context_isolation [EXTRACTED 1.00]
- **Chrome Extension to Desktop App Native Messaging Integration** — docs_summaries_resumo_integracao_native_messaging_host, docs_summaries_resumo_integracao_session_file, docs_summaries_resumo_integracao_getentriesfromnativeapp, docs_summaries_resumo_integracao_sendnativemessage, docs_summaries_resumo_integracao_connectnativeapp, docs_summaries_resumo_integracao_url_entry_filtering, docs_summaries_resumo_integracao_pid_verification, docs_summaries_resumo_integracao_com_mysecrets_native_json [EXTRACTED 1.00]
- **Vault Encryption Scheme (PBKDF2 + salt/IV + AES-256-CBC)** — docs_user_security_pbkdf2_sha256, docs_user_security_unique_salt_and_iv, docs_user_security_aes_256_cbc, docs_user_security_encrypt, docs_user_security_decrypt, docs_user_security_key_derivation_process [EXTRACTED 1.00]
- **Legacy Native Messaging autofill flow** — docs_extension_integracao_extensao_native_messaging_host, native_host_install, docs_extension_integracao_extensao_native_messaging_manifest, docs_extension_integracao_extensao_session_file, docs_developer_developer_guide_secrets_enc, docs_extension_integracao_extensao_url_filtering [EXTRACTED 1.00]
- **Renderer Security Settings Controls** — src_renderer_index_setting_auto_lock, src_renderer_index_setting_clipboard_clear, src_renderer_index_setting_global_shortcut, src_renderer_index_setting_auto_backup, src_renderer_index_reset_confirmation_modal [INFERRED 0.75]
- **Extension pairing and autofill flow** — chrome_extension_popup_pair_screen, chrome_extension_readme_extension_pairing_code, chrome_extension_readme_extension_local_server, chrome_extension_readme_extension_just_in_time_secrets [INFERRED 0.85]
- **Local server pairing/autofill flow** — docs_developer_changelog_local_server_autofill, docs_developer_changelog_pairing_code, docs_developer_changelog_mcp_token_file, docs_privacy_site_index_data_accessed [INFERRED 0.85]
- **External clients access vault only via unlocked app session** — mcp_server_readme_session_file, native_host_readme_session_model, chrome_extension_readme_extension_local_server, mcp_server_readme_http_transport [INFERRED 0.85]
- **Chrome extension icon size set (16/32/48/128)** — chrome_extension_icons_icon16_extension_icon_16, chrome_extension_icons_icon32_extension_icon_32, chrome_extension_icons_icon48_extension_icon_48, chrome_extension_icons_icon128_extension_icon_128 [INFERRED 0.95]

## Communities (67 total, 5 thin omitted)

### Community 0 - "Renderer DOM & State"
Cohesion: 0.02
Nodes (86): addCustomFieldBtn, addEntryBtn, authScreen, AVAILABLE_THEMES, cancelImportBtn, cancelResetBtn, clearSearchBtn, confirmImportBtn (+78 more)

### Community 1 - "Vault Access Integrations"
Cohesion: 0.05
Nodes (52): Makefile Quick Commands reference, Chrome extension make targets (extension, ext-icons, ext-pack, ext-install), make build-linux (AppImage build), make dev (run with DevTools), make test-totp (TOTP/MFA generation test), Makefile workflows (first time, daily dev, release, troubleshooting), Extension Icons README, create-icons.sh (SVG to PNG via ImageMagick) (+44 more)

### Community 2 - "jsQR Decoder Core"
Cohesion: 0.06
Nodes (37): binarize(), BitMatrix(), BitStream(), buildFunctionPatternMask(), computeDimension(), countBlackWhiteRun(), countBlackWhiteRunTowardsPoint(), decode() (+29 more)

### Community 3 - "Security Policy & Crypto"
Cohesion: 0.05
Nodes (51): Master Password Creation (no recovery), SECURITY.md - Security Policy, AES-256-CBC Encryption, Compliance (OWASP, CWE, NIST), Cryptographic Specifications Table, decrypt(encryptedData, password), Electron Security Guide, encrypt(plaintext, password) (+43 more)

### Community 4 - "Documentation Index"
Cohesion: 0.13
Nodes (24): RESUMO_INTEGRACAO.md - Extension + Desktop Integration Summary, Extension Autofill Flow via Native Messaging, com.mysecrets.native.json manifest, connectNativeApp(), getEntriesFromNativeApp(), Fallback to Extension Local Storage, make ext-check, make ext-integrate (+16 more)

### Community 5 - "main.js"
Cohesion: 0.06
Nodes (32): agentWriteQueue, { app, BrowserWindow, Menu, Tray, ipcMain, dialog, safeStorage, clipboard, nativeImage, globalShortcut, powerMonitor, shell }, checkHelloAvailability(), crypto, { execFile, spawn }, extensionSaves, fs, gdrive (+24 more)

### Community 6 - "vault.js"
Cohesion: 0.14
Nodes (17): checkSession(), crypto, decryptSession(), decryptVault(), fs, generateOtp(), generateSessionKey(), getSecretsFile() (+9 more)

### Community 7 - "MCP Tool Dispatch"
Cohesion: 0.08
Nodes (35): buildCommon(), buildFile(), buildTarget(), buildWriteRequest(), callTool(), callWriteTool(), describeRequest(), dispatch() (+27 more)

### Community 8 - "Extension Manifest"
Cohesion: 0.06
Nodes (34): action, default_icon, default_popup, description, suggested_key, background, service_worker, type (+26 more)

### Community 9 - "Entry Views & Rendering"
Cohesion: 0.16
Nodes (34): activeData(), attachFilesToEntry(), backToGridView(), computeHealthIssues(), copyToClipboard(), createGridCard(), currentFilterType(), deleteEntry() (+26 more)

### Community 10 - "Documentation Index (INDEX.md)"
Cohesion: 0.24
Nodes (10): Documentation Structure overview, Docs categories (user, developer, extension, guides, summaries), make docs / docs-open / docs-user / docs-dev / docs-ext, Reading flows by persona (new user, developer, extension), Documentation Index (INDEX.md), Security-concerned reading flow, Quick Start Guide, Encrypted .enc backup export/import (+2 more)

### Community 11 - "Password Generator & Theme"
Cohesion: 0.10
Nodes (23): clearSearch(), closeResetModal(), closeThemeMenu(), computePasswordStrength(), copyGeneratedPassword(), generateNewPassword(), handleMfaQrImageSelect(), handleReset() (+15 more)

### Community 12 - "Content Script Autofill"
Cohesion: 0.22
Nodes (23): captureLogin(), detectOnLoad(), fillCustomFields(), fillField(), fillLoginForm(), findLoginForm(), findMfaField(), findPasswordFields() (+15 more)

### Community 13 - "Extension Popup UI"
Cohesion: 0.16
Nodes (23): ask(), autofill(), el(), entries, Error screen (retry, help instructions), initialize(), Entries list screen (search, current site, entries, unpair), loadEntries() (+15 more)

### Community 14 - "Changelog & Releases"
Cohesion: 0.13
Nodes (19): Auto-update via plugato/mySecrets-releases, MySecrets Changelog, Optional global shortcut Ctrl+Shift+M, Keep a Changelog / Semantic Versioning, .mcp-token persistent server token, Pairing code (URL + token), MySecrets roadmap (1.1, 1.2, 2.0), SSO_BANK shared password group (+11 more)

### Community 15 - "Auto-lock & MCP Modal"
Cohesion: 0.14
Nodes (25): closeModals(), getSettings(), isUnlocked(), lockApp(), openMcpModal(), refreshMcpStatus(), reloadVaultFromDisk(), renderMcpStatus() (+17 more)

### Community 16 - "background.js"
Cohesion: 0.16
Nodes (27): autoPair(), ensurePaired(), entriesForUrl(), fillFirstMatch(), fillTab(), getConn(), getPending(), handlers (+19 more)

### Community 17 - "Package Metadata"
Cohesion: 0.17
Nodes (12): author, dependencies, electron-updater@^6.8.9, otplib@^12.0.1, description, homepage, keywords, license (+4 more)

### Community 18 - "Build Config"
Cohesion: 0.12
Nodes (16): build, appId, asarUnpack, directories, files, mac, nsis, portable (+8 more)

### Community 19 - "Entry Form & Custom Fields"
Cohesion: 0.24
Nodes (12): addCustomField(), applyOtpauthToForm(), generateCustomFieldId(), handleEntryTypeChange(), handleMfaAlgorithmChange(), loadCustomFields(), openEntryModal(), populateForm() (+4 more)

### Community 20 - "Contributing Guidelines"
Cohesion: 0.22
Nodes (8): Code of Conduct, Contributing to MySecrets, Conventional Commits convention, JSDoc code documentation, Pull request process, Test scripts (test-totp.js, test-methods.js, test-conversion.js), MySecrets Developer Guide, Internationalization (i18n) approach

### Community 21 - "Login & Windows Hello"
Cohesion: 0.23
Nodes (12): autoHelloLogin(), cancelHelloLogin(), handleHelloLogin(), handleLogin(), handleSetup(), hideError(), offerHelloEnrollment(), purgeExpiredTrash() (+4 more)

### Community 22 - "Core Security Features"
Cohesion: 0.17
Nodes (11): Clipboard auto-clear after 30s, Encrypted backup export/import (.enc), TOTP/HOTP support via otplib, Release 1.0.0: initial stable release, Adding a new IPC handler (main -> preload -> renderer), IPC handlers (save-data, load-data, generate-totp, generate-hotp), Main process (src/main.js), MFA implementation with otplib (+3 more)

### Community 23 - "Run & Build Guides"
Cohesion: 0.28
Nodes (9): electron-builder build configuration, Quick commands (COMO_USAR), Entry types (Login, MFA, Token, Secure Note), How to run and build MySecrets (EXECUTAR_PROJETO), npm scripts (dev, start, build, build-linux, build-win, pack), Wine for Windows cross-build, make ext-integrate / ext-check, Make targets (dev, build-linux, status, clean, ext-*) (+1 more)

### Community 24 - "Extension Summary Docs"
Cohesion: 0.20
Nodes (14): Content script login form detection and fill, Extension popup UI, Chrome Extension Summary (MySecrets Autofill), MutationObserver for SPA detection, Native Messaging integration (optional), Comparison vs LastPass/1Password/Bitwarden, Standalone test mode, Extension + Desktop Integration guide (Native Messaging) (+6 more)

### Community 25 - "Preload & Dev Deps"
Cohesion: 0.22
Nodes (7): devDependencies, electron@^38.2.1, electron-builder@^26.15.3, electron, electron-builder, { contextBridge, ipcRenderer }, { contextBridge, ipcRenderer }

### Community 26 - "npm Scripts"
Cohesion: 0.22
Nodes (9): scripts, build, build-linux, build-win, dev, dist, pack, start (+1 more)

### Community 27 - "MFA/TOTP Generation"
Cohesion: 0.20
Nodes (8): copyMFACode(), createMFARow(), editEntry(), MFA, renderMFACodes(), showMFAOverview(), startMFARowTimer(), startMFATimer()

### Community 29 - "google-drive.js"
Cohesion: 0.10
Nodes (15): authorize(), base64url(), crypto, DriveClient, getJson(), http, loadClientConfig(), postForm() (+7 more)

### Community 30 - "App & Extension Icons"
Cohesion: 0.40
Nodes (6): mySecrets App Icon (padlock on purple gradient), Padlock Brand Identity (white lock, blue-violet gradient rounded square), Chrome Extension Icon 128px, Chrome Extension Icon 16px, Chrome Extension Icon 32px, Chrome Extension Icon 48px

### Community 31 - "INSTALLATION.md - Installation Guide"
Cohesion: 0.13
Nodes (18): DOCS_INDEX.md - Documentation Index, Documentation Roadmap, Documentation Learning Paths (Beginner/Developer/Power User), Quick Navigation by Goal ('I want to...'), Bilingual Documentation (PT-BR + EN), Documentation Statistics (~4,900 lines, 9 files), Recommended Reading Paths, INSTALLATION.md - Installation Guide (+10 more)

### Community 32 - "escapeHtml"
Cohesion: 0.19
Nodes (14): convertBitwardenToMySecrets(), convertExternalToMySecrets(), createEntryElement(), entrySubtitle(), entryTagsHTML(), escapeHtml(), generateId(), handleFileSelect() (+6 more)

### Community 33 - "Release Publish Config"
Cohesion: 0.40
Nodes (5): publish, owner, provider, releaseType, repo

### Community 34 - "Dev Update Config"
Cohesion: 0.50
Nodes (3): owner, provider, repo

### Community 35 - "attachments.test.js"
Cohesion: 0.11
Nodes (15): applyAgentWrite(), assert, crypto, DATA_DIR, FAKE_AES, FAKE_JKS, fakeApp(), { fork, spawn } (+7 more)

### Community 40 - "proton-pass-import.test.js"
Cohesion: 0.16
Nodes (13): RFC-4180, convertProtonPassToMySecrets(), extractTextFromZip(), isProtonPassCsv(), isProtonPassJson(), parseCsv(), parseImportTotp(), protonPassCsvToJson() (+5 more)

### Community 41 - "vault-sync.js"
Cohesion: 0.14
Nodes (8): entryTime(), fs, mergeTombstones(), mergeVaults(), os, path, readTombstones(), tempo()

### Community 42 - "vault-sync.test.js"
Cohesion: 0.12
Nodes (10): assert, fs, os, path, { test }, assert, crypto, fs (+2 more)

### Community 43 - "vaultFile"
Cohesion: 0.22
Nodes (16): backupsPath(), createWindow(), disableFolderSync(), exportBackup(), fileHash(), importBackup(), isSyncEnabled(), listAutoBackups() (+8 more)

### Community 44 - "files.js"
Cohesion: 0.24
Nodes (12): attachmentFromBuffer(), crypto, formatSize(), fs, guessMime(), MIME_BY_EXT, path, readFileAsAttachment() (+4 more)

### Community 45 - "runGdriveSync"
Cohesion: 0.22
Nodes (14): encryptVault(), entriesHash(), gdriveStatus(), gdriveSync(), isGdriveConnected(), notifyGdrive(), readEncryptedEntries(), readGdriveState() (+6 more)

### Community 46 - "MySecrets README"
Cohesion: 0.17
Nodes (9): Copilot Instructions (project setup checklist), Electron password and MFA manager, MySecrets MCP Server README, MYSECRETS_DATA_DIR environment variable, stdio transport spawned by client (node mcp-server/index.js), MySecrets README, make ext-integrate / ext-check, MySecrets desktop app (Electron) (+1 more)

### Community 47 - "vault-crypto.test.js"
Cohesion: 0.23
Nodes (9): crypto, decryptVault(), deriveKey(), encryptVaultLegacy(), isLegacyFormat(), readVault(), assert, PAYLOAD (+1 more)

### Community 48 - "publish-chrome-extension.test.js"
Cohesion: 0.17
Nodes (11): assert, crypto, escreverZip(), fs, key, os, path, { privateKey, publicKey } (+3 more)

### Community 49 - "test-host.js"
Cohesion: 0.17
Nodes (10): fullMessage, host, hostScript, lengthBuffer, message, messageBuffer, messageStr, path (+2 more)

### Community 50 - "index.js"
Cohesion: 0.22
Nodes (6): appEndpoint(), ctx, forwardToApp(), fs, http, path

### Community 51 - "publish-chrome-extension.js"
Cohesion: 0.31
Nodes (8): api(), b64url(), crypto, fs, knownVersions(), manifestVersionFromZip(), publish(), serviceAccountToken()

### Community 52 - "encryptSession"
Cohesion: 0.22
Nodes (10): createSession(), decryptSession(), destroySession(), encryptSession(), gdriveClient(), generateSessionKey(), getMachineSecret(), protectToken() (+2 more)

### Community 53 - "agent-write.js"
Cohesion: 0.31
Nodes (8): AGENT_FIELD_LABELS, AGENT_FIELD_NAMES, entryAttachments(), findAgentTarget(), inferType(), normalizeProjectTag(), planAgentWrite(), requestTags()

### Community 54 - "steps"
Cohesion: 0.28
Nodes (9): steps, steps, steps, if, name, run, shell, uses (+1 more)

### Community 55 - "with"
Cohesion: 0.22
Nodes (9): with, cache, files, if-no-files-found, merge-multiple, name, node-version, path (+1 more)

### Community 56 - "processAgentWrite"
Cohesion: 0.25
Nodes (9): agentDialogDetail(), approveExtension(), askRenderer(), handleAgentWrite(), handleMcpMessage(), oneLine(), processAgentWrite(), trustedExtensions() (+1 more)

### Community 57 - "build"
Cohesion: 0.25
Nodes (8): runs-on, strategy, os, platform, build, include, fail-fast, matrix

### Community 58 - "jobs"
Cohesion: 0.29
Nodes (6): jobs, name, on, push, workflow_dispatch, tags

### Community 59 - "env"
Cohesion: 0.29
Nodes (7): CSC_IDENTITY_AUTO_DISCOVERY, CWS_EXTENSION_ID, CWS_PUBLISHER_ID, CWS_SERVICE_ACCOUNT_JSON, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, env

### Community 60 - "ref_fs"
Cohesion: 0.33
Nodes (4): convertExternalToMySecrets(), crypto, fs, generateId()

### Community 61 - "startMcpServer"
Cohesion: 0.33
Nodes (7): getMcpServerPath(), getMcpStatus(), getMcpToken(), removeMcpEndpoint(), startMcpServer(), stopMcpServer(), writeMcpEndpoint()

### Community 62 - "release"
Cohesion: 0.33
Nodes (6): release, contents, if, needs, permissions, runs-on

### Community 63 - "ref_crypto"
Cohesion: 0.33
Nodes (3): otplib, secret, url

### Community 64 - "linux"
Cohesion: 0.40
Nodes (5): linux, category, icon, maintainer, target

### Community 65 - "sendLockToRenderer"
Cohesion: 0.40
Nodes (5): applyGlobalShortcut(), createTray(), sendLockToRenderer(), setupPowerMonitor(), toggleMainWindow()

### Community 66 - "chrome-web-store"
Cohesion: 0.50
Nodes (4): if, needs, runs-on, chrome-web-store

## Ambiguous Edges - Review These
- `mysecrets-host.js` → `Local loopback server 127.0.0.1:8765 with bearer token`  [AMBIGUOUS]
  chrome-extension/README_EXTENSION.md · relation: semantically_similar_to
- `install.sh (native host installer)` → `make ext-integrate / ext-check`  [AMBIGUOUS]
  README.md · relation: references
- `PBKDF2-SHA256 (100,000 iterations)` → `Session File (~/.config/mysecrets/.session)`  [AMBIGUOUS]
  docs/summaries/RESUMO_INTEGRACAO.md · relation: conceptually_related_to

## Knowledge Gaps
- **58 isolated node(s):** `RFC-4180`, `MYSECRETS_DATA_DIR environment variable`, `stdio transport spawned by client (node mcp-server/index.js)`, `make build-linux (AppImage build)`, `Makefile workflows (first time, daily dev, release, troubleshooting)` (+53 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 448 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MySecrets README` connect `MySecrets README` to `Vault Access Integrations`, `Security Policy & Crypto`, `Documentation Index (INDEX.md)`, `Changelog & Releases`, `Contributing Guidelines`, `Run & Build Guides`, `Extension Summary Docs`, `INSTALLATION.md - Installation Guide`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Are the 27 inferred relationships involving `setupEventListeners()` (e.g. with `addCustomField()` and `clearSearch()`) actually correct?**
  _`setupEventListeners()` has 27 INFERRED edges - model-reasoned connections that need verification._
- **What connects `RFC-4180`, `MYSECRETS_DATA_DIR environment variable`, `stdio transport spawned by client (node mcp-server/index.js)` to the rest of the system?**
  _58 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Renderer DOM & State` be split into smaller, more focused modules?**
  _Cohesion score 0.023255813953488372 - nodes in this community are weakly interconnected._
- **Why does `Project structure (src, chrome-extension, native-host, docs)` connect `Vault Access Integrations` to `MySecrets README`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `mysecrets-host.js` and `Local loopback server 127.0.0.1:8765 with bearer token`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `install.sh (native host installer)` and `make ext-integrate / ext-check`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
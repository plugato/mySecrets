# Developer Guide - MySecrets

This guide provides detailed technical information for developers who want to contribute to or modify MySecrets.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Development Setup](#development-setup)
3. [Code Structure](#code-structure)
4. [Security Implementation](#security-implementation)
5. [Adding New Features](#adding-new-features)
6. [Testing](#testing)
7. [Building & Distribution](#building--distribution)
8. [Common Tasks](#common-tasks)

## Architecture Overview

MySecrets follows Electron's multi-process architecture with strict security boundaries:

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Process (main.js)                  │
│  - Window management                                         │
│  - IPC handlers                                             │
│  - File system operations                                   │
│  - Encryption/Decryption                                    │
│  - MFA code generation                                      │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      │ IPC (Inter-Process Communication)
                      │
┌─────────────────────┴───────────────────────────────────────┐
│                  Preload Script (preload.js)                 │
│  - Context Bridge API                                        │
│  - Secure IPC wrapper                                       │
│  - No direct Node.js access to renderer                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      │ contextBridge.exposeInMainWorld
                      │
┌─────────────────────┴───────────────────────────────────────┐
│               Renderer Process (renderer/*.*)                │
│  - UI rendering (HTML/CSS)                                  │
│  - User interactions (app.js)                               │
│  - No Node.js access (context isolation)                    │
│  - Only accesses main process via window.api                │
└─────────────────────────────────────────────────────────────┘
```

### Security Layers

1. **Context Isolation**: Renderer process is completely isolated from Node.js
2. **No Node Integration**: `nodeIntegration: false` prevents direct Node.js access
3. **Preload Script**: Only whitelisted APIs exposed via contextBridge
4. **IPC Validation**: All IPC messages validated in main process
5. **Navigation Prevention**: External navigation blocked

## Development Setup

### Prerequisites

```bash
# Required
node --version  # Should be v16+ or higher
npm --version   # Should be v8+ or higher

# Optional (for cross-platform builds)
wine --version  # For building Windows on Linux
```

### Initial Setup

```bash
# Clone repository
git clone <repository-url>
cd mySecrets

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Development Tools

- **DevTools**: Automatically opens in dev mode (main.js line 62)
- **Logs**: Check terminal for main process logs
- **Reloading**: Manual restart required for code changes

### Environment Variables

Create a `.env` file for development (not tracked in git):

```bash
# Enable debug logging
DEBUG=true

# Custom data directory
DATA_DIR=/path/to/test/data
```

## Code Structure

### Main Process (src/main.js)

**Key Functions:**

```javascript
// Window Management
createWindow() // Creates and configures main browser window

// Encryption
encrypt(text, password)  // Returns { encrypted, salt, iv }
decrypt(encryptedData, password)  // Returns decrypted text

// IPC Handlers
ipcMain.handle('save-data', ...) // Encrypts and saves data
ipcMain.handle('load-data', ...) // Loads and decrypts data
ipcMain.handle('generate-totp', ...) // Generates TOTP code
ipcMain.handle('generate-hotp', ...) // Generates HOTP code

// Backup
exportBackup() // Exports encrypted file
importBackup() // Imports and replaces data
```

**Important Constants:**

```javascript
const userDataPath = app.getPath('userData')
const dataPath = path.join(userDataPath, 'secrets.enc')
```

### Preload Script (src/preload.js)

**Exposed API:**

```javascript
window.api = {
  saveData: (data, password) => Promise<Result>,
  loadData: (password) => Promise<Result>,
  checkDataExists: () => Promise<boolean>,
  resetData: () => Promise<Result>,
  generateTOTP: (secret, options) => Promise<TOTPResult>,
  generateHOTP: (secret, counter, options) => Promise<HOTPResult>,
  verifyTOTP: (token, secret, options) => Promise<VerifyResult>
}
```

### Renderer Process (src/renderer/app.js)

**State Management:**

```javascript
let masterPassword = null;  // Never persisted
let entries = [];           // Decrypted entries in memory
let currentFilter = 'all';  // Current category filter
let searchTerm = '';        // Current search term
let currentEntryId = null;  // Currently selected entry
```

**Key Functions:**

```javascript
// Authentication
login()           // Handles master password login
setupVault()      // Creates new vault

// Data Management
saveAllData()     // Encrypts and saves all entries
loadData()        // Loads and decrypts entries
addEntry()        // Adds new entry
updateEntry()     // Updates existing entry
deleteEntry()     // Deletes entry

// UI Rendering
renderEntries()   // Renders entry list
showEntryDetails()// Shows entry details
filterEntries()   // Applies filters

// MFA
updateMFACodes()  // Updates TOTP codes (runs every second)
generateMFACode() // Generates MFA code for entry
```

## Security Implementation

### Encryption Flow

```javascript
// 1. User enters master password
const masterPassword = "user's password";

// 2. Generate random salt (16 bytes)
const salt = crypto.randomBytes(16);

// 3. Derive encryption key using PBKDF2
const key = crypto.pbkdf2Sync(
  masterPassword,
  salt,
  100000,      // iterations
  32,          // key length (256 bits)
  'sha256'     // hash algorithm
);

// 4. Generate random IV (16 bytes)
const iv = crypto.randomBytes(16);

// 5. Encrypt data with AES-256-CBC
const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
encrypted += cipher.final('hex');

// 6. Store encrypted data with salt and IV
const stored = {
  encrypted: encrypted,
  salt: salt.toString('hex'),
  iv: iv.toString('hex')
};
```

### Decryption Flow

```javascript
// 1. Load stored data
const stored = JSON.parse(fs.readFileSync(dataPath));

// 2. Recreate salt and IV from hex
const salt = Buffer.from(stored.salt, 'hex');
const iv = Buffer.from(stored.iv, 'hex');

// 3. Derive same key from master password
const key = crypto.pbkdf2Sync(masterPassword, salt, 100000, 32, 'sha256');

// 4. Decrypt data
const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
let decrypted = decipher.update(stored.encrypted, 'hex', 'utf8');
decrypted += decipher.final('utf8');

// 5. Parse JSON
const data = JSON.parse(decrypted);
```

### MFA Implementation

**TOTP (Time-based One-Time Password):**

```javascript
// Using otplib
const totp = require('otplib').authenticator;

// Configure
totp.options = {
  digits: 6,         // 6 or 8 digits
  period: 30,        // Time step in seconds
  algorithm: 'sha1'  // sha1, sha256, or sha512
};

// Generate code
const code = totp.generate(secret);

// Calculate remaining time
const epoch = Math.floor(Date.now() / 1000);
const remaining = period - (epoch % period);
```

**HOTP (Counter-based One-Time Password):**

```javascript
// Using otplib
const hotp = require('otplib').hotp;

// Configure
hotp.options = {
  digits: 6,         // 6 or 8 digits
  algorithm: 'sha1'  // sha1, sha256, or sha512
};

// Generate code
const code = hotp.generate(secret, counter);

// Increment counter for next use
counter++;
```

### Security Best Practices

1. **Never log sensitive data**
   ```javascript
   // BAD
   console.log('Password:', password);
   
   // GOOD
   console.log('Password set:', !!password);
   ```

2. **Clear sensitive data from memory**
   ```javascript
   // After use
   password = null;
   delete entry.password;
   ```

3. **Validate all inputs**
   ```javascript
   if (!masterPassword || masterPassword.length < 8) {
     throw new Error('Master password too short');
   }
   ```

4. **Use secure random generation**
   ```javascript
   // BAD
   const id = Math.random().toString();
   
   // GOOD
   const id = crypto.randomBytes(16).toString('hex');
   ```

## Adding New Features

### Adding a New Entry Type

1. **Update HTML** (src/renderer/index.html):
   ```html
   <option value="new-type">New Type</option>
   ```

2. **Add form fields**:
   ```html
   <div class="form-group" id="new-type-group" style="display: none;">
     <label for="entry-new-field">New Field:</label>
     <input type="text" id="entry-new-field" class="input-field">
   </div>
   ```

3. **Update JavaScript** (src/renderer/app.js):
   ```javascript
   // In entry type change handler
   document.getElementById('entry-type').addEventListener('change', (e) => {
     if (e.target.value === 'new-type') {
       document.getElementById('new-type-group').style.display = 'block';
     }
   });
   
   // In save handler
   if (type === 'new-type') {
     entryData.newField = document.getElementById('entry-new-field').value;
   }
   ```

4. **Add filter button**:
   ```html
   <button class="filter-btn" data-type="new-type">
     <span class="material-symbols-outlined">icon_name</span>
     <span>New Type</span>
     <span class="count" id="count-new-type">0</span>
   </button>
   ```

5. **Update rendering logic**:
   ```javascript
   function renderEntryDetails(entry) {
     if (entry.type === 'new-type') {
       // Add rendering logic
     }
   }
   ```

### Adding a New IPC Handler

1. **Main Process** (src/main.js):
   ```javascript
   ipcMain.handle('new-operation', async (event, param1, param2) => {
     try {
       // Validate inputs
       if (!param1) {
         throw new Error('Invalid param1');
       }
       
       // Perform operation
       const result = performOperation(param1, param2);
       
       return { success: true, data: result };
     } catch (error) {
       return { success: false, error: error.message };
     }
   });
   ```

2. **Preload Script** (src/preload.js):
   ```javascript
   contextBridge.exposeInMainWorld('api', {
     // ... existing methods
     newOperation: (param1, param2) => ipcRenderer.invoke('new-operation', param1, param2)
   });
   ```

3. **Renderer Process** (src/renderer/app.js):
   ```javascript
   async function callNewOperation() {
     const result = await window.api.newOperation(param1, param2);
     if (result.success) {
       console.log('Success:', result.data);
     } else {
       console.error('Error:', result.error);
     }
   }
   ```

### Adding a New Menu Item

In `src/main.js`, update menu template:

```javascript
const template = [
  {
    label: 'New Menu',
    submenu: [
      {
        label: 'New Item',
        accelerator: 'Ctrl+N',
        click: () => {
          // Handle click
          mainWindow.webContents.send('menu-new-item');
        }
      }
    ]
  }
];
```

Listen in renderer:

```javascript
// Note: Requires adding ipcRenderer to preload
window.api.onMenuNewItem((callback) => {
  // Handle menu action
});
```

## Testing

### Manual Testing

1. **Authentication Flow**
   - Test first-time setup
   - Test login with correct password
   - Test login with wrong password
   - Test forgot password flow

2. **Data Operations**
   - Add all entry types
   - Edit entries
   - Delete entries
   - Search/filter entries

3. **MFA Testing**
   - Test TOTP with known secret
   - Test HOTP generation
   - Verify codes with services
   - Test different periods/digits

4. **Backup/Restore**
   - Export backup
   - Import backup
   - Verify data integrity

### Automated Testing

Create test scripts in project root:

**test-encryption.js:**
```javascript
const crypto = require('crypto');

function encrypt(text, password) {
  // Copy encrypt function from main.js
}

function decrypt(encryptedData, password) {
  // Copy decrypt function from main.js
}

// Test
const original = 'Test data';
const password = 'test-password';
const encrypted = encrypt(original, password);
const decrypted = decrypt(encrypted, password);

console.assert(original === decrypted, 'Encryption test failed');
console.log('✓ Encryption test passed');
```

Run: `node test-encryption.js`

### Test Data

Create `test-data.json`:
```json
[
  {
    "id": "test-1",
    "type": "login",
    "title": "Test Login",
    "username": "test@example.com",
    "password": "testpassword123",
    "url": "https://example.com"
  },
  {
    "id": "test-2",
    "type": "mfa",
    "title": "Test TOTP",
    "mfaAlgorithm": "totp",
    "mfaSecret": "JBSWY3DPEHPK3PXP",
    "mfaPeriod": 30,
    "mfaDigits": 6
  }
]
```

## Building & Distribution

### Build Configuration

Edit `package.json` build section:

```json
{
  "build": {
    "appId": "com.mysecrets.app",
    "productName": "MySecrets",
    "directories": {
      "output": "dist"
    },
    "files": [
      "src/**/*",
      "node_modules/**/*",
      "!node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}",
      "!node_modules/*/{test,__tests__,tests,powered-test,example,examples}",
      "!node_modules/*.d.ts",
      "!node_modules/.bin"
    ],
    "compression": "maximum",
    "asar": true,
    "win": {
      "target": ["nsis"],
      "icon": "assets/icon.ico",
      "requestedExecutionLevel": "asInvoker"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    },
    "linux": {
      "target": ["AppImage", "deb", "rpm"],
      "icon": "assets/icon.png",
      "category": "Utility"
    }
  }
}
```

### Building Process

```bash
# Clean previous builds
rm -rf dist/

# Build for current platform
npm run build

# Build for specific platform
npm run build-win   # Windows
npm run build-linux # Linux

# Test packaged app without installer
npm run pack
```

### Code Signing (Optional)

**Windows:**
```bash
# Set environment variables
export CSC_LINK=/path/to/certificate.pfx
export CSC_KEY_PASSWORD=certificate-password

# Build with signing
npm run build-win
```

**macOS:**
```bash
export CSC_LINK=/path/to/certificate.p12
export CSC_KEY_PASSWORD=certificate-password
export APPLEID=your-apple-id@email.com
export APPLEIDPASS=app-specific-password

npm run build
```

## Common Tasks

### Change App Icon

1. **Prepare icons:**
   - Windows: 256x256 PNG → Convert to .ico
   - Linux: 512x512 PNG
   - macOS: 1024x1024 PNG → Convert to .icns

2. **Use icon converter:**
   ```bash
   # Install imagemagick
   sudo apt install imagemagick
   
   # Convert PNG to ICO
   convert icon.png -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico
   ```

3. **Update paths** in `package.json`:
   ```json
   "win": {
     "icon": "assets/icon.ico"
   },
   "linux": {
     "icon": "assets/icon.png"
   }
   ```

### Change Data Storage Location

In `src/main.js`:

```javascript
// Default
const userDataPath = app.getPath('userData');

// Custom
const userDataPath = '/custom/path/to/data';

// User's home directory
const userDataPath = path.join(require('os').homedir(), '.mysecrets');
```

### Add Debug Logging

Create logging utility:

```javascript
// src/logger.js
const isDev = process.argv.includes('--dev');

function log(...args) {
  if (isDev) {
    console.log('[MySecrets]', ...args);
  }
}

function error(...args) {
  console.error('[MySecrets ERROR]', ...args);
}

module.exports = { log, error };
```

Use in code:

```javascript
const { log, error } = require('./logger');

log('Application started');
error('Failed to load data:', err);
```

### Performance Optimization

1. **Lazy load large lists:**
   ```javascript
   function renderEntries(entries) {
     // Only render visible entries
     const visibleEntries = entries.slice(0, 50);
     // Use virtual scrolling for large lists
   }
   ```

2. **Debounce search:**
   ```javascript
   let searchTimeout;
   searchInput.addEventListener('input', (e) => {
     clearTimeout(searchTimeout);
     searchTimeout = setTimeout(() => {
       performSearch(e.target.value);
     }, 300);
   });
   ```

3. **Optimize MFA updates:**
   ```javascript
   // Only update visible MFA codes
   function updateMFACodes() {
     const visibleMFAs = document.querySelectorAll('.mfa-code:visible');
     visibleMFAs.forEach(updateSingleMFA);
   }
   ```

### Adding Internationalization (i18n)

1. **Create language files:**
   ```javascript
   // src/lang/en.json
   {
     "login": "Login",
     "password": "Password",
     "save": "Save"
   }
   
   // src/lang/pt-BR.json
   {
     "login": "Entrar",
     "password": "Senha",
     "save": "Salvar"
   }
   ```

2. **Load language:**
   ```javascript
   const currentLang = localStorage.getItem('language') || 'en';
   const translations = require(`./lang/${currentLang}.json`);
   
   function t(key) {
     return translations[key] || key;
   }
   ```

3. **Use in HTML:**
   ```javascript
   document.getElementById('login-btn').textContent = t('login');
   ```

## Debugging Tips

### Debug Main Process

```javascript
// Add to main.js
console.log('Main process started');
console.log('User data path:', userDataPath);
console.log('Data path:', dataPath);
```

### Debug Renderer Process

Open DevTools and use:

```javascript
// Check if API is exposed
console.log('API available:', !!window.api);

// Test IPC communication
window.api.checkDataExists().then(console.log);

// Monitor entry changes
console.log('Current entries:', entries);
```

### Debug IPC Issues

In `preload.js`:

```javascript
contextBridge.exposeInMainWorld('api', {
  saveData: (data, password) => {
    console.log('Preload: saveData called', { dataLength: data.length });
    return ipcRenderer.invoke('save-data', data, password);
  }
});
```

In `main.js`:

```javascript
ipcMain.handle('save-data', async (event, data, masterPassword) => {
  console.log('Main: save-data handler called', {
    dataLength: data.length,
    hasPassword: !!masterPassword
  });
  // ... rest of handler
});
```

### Debug Encryption

```javascript
// Add before encryption
console.log('Plain text length:', text.length);
console.log('Password length:', password.length);

// Add after encryption
console.log('Encrypted data:', {
  encryptedLength: encrypted.length,
  saltLength: salt.length,
  ivLength: iv.length
});
```

## Contributing Guidelines

1. **Code Style:**
   - Use 2 spaces for indentation
   - Use single quotes for strings
   - Add comments for complex logic
   - Keep functions small and focused

2. **Git Workflow:**
   ```bash
   # Create feature branch
   git checkout -b feature/my-feature
   
   # Make changes and commit
   git add .
   git commit -m "feat: add my feature"
   
   # Push and create PR
   git push origin feature/my-feature
   ```

3. **Commit Messages:**
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation only
   - `style:` Formatting, missing semi-colons
   - `refactor:` Code restructuring
   - `test:` Adding tests
   - `chore:` Maintenance

4. **Pull Request:**
   - Describe what changes were made
   - Link related issues
   - Include screenshots for UI changes
   - Ensure builds successfully

## Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [Node.js Crypto](https://nodejs.org/api/crypto.html)
- [otplib Documentation](https://github.com/yeojz/otplib)
- [electron-builder](https://www.electron.build/)

## Getting Help

- Check existing documentation
- Search closed issues
- Ask in discussions
- Open new issue with details

---

Happy coding! 🚀


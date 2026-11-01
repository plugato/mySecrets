# Quick Start Guide - MySecrets

Get up and running with MySecrets in 5 minutes!

## 📥 Installation (3 steps)

### Linux

```bash
# 1. Download AppImage
wget https://github.com/your-repo/mysecrets/releases/latest/download/MySecrets-1.0.0.AppImage

# 2. Make executable
chmod +x MySecrets-1.0.0.AppImage

# 3. Run
./MySecrets-1.0.0.AppImage
```

### Windows

```bash
# 1. Download installer
# Download MySecrets-Setup-1.0.0.exe from releases

# 2. Run installer
# Double-click the .exe file

# 3. Follow installation wizard
```

### From Source

```bash
# 1. Clone and install
git clone <repo-url>
cd mySecrets
npm install

# 2. Run
npm run dev
```

## 🚀 First Launch (2 minutes)

### 1. Create Master Password

When you first open MySecrets, you'll see:

```
┌─────────────────────────────────────┐
│  🔐 MySecrets                       │
│  Setup Your Vault                   │
│                                     │
│  [Enter Master Password]            │
│  [Confirm Master Password]          │
│                                     │
│  [Create Vault]                     │
└─────────────────────────────────────┘
```

**Tips:**
- Use at least 12 characters
- Mix letters, numbers, and symbols
- Make it memorable but strong
- **Write it down safely** - you can't recover it!

### 2. Add Your First Entry

Click **"Add"** button and choose a type:

#### 🔑 Login Entry
```
Title: GitHub
URL: https://github.com
Username: your@email.com
Password: [Generate] or type your own
```

#### 🔐 MFA Code (TOTP)
```
Title: Google Authenticator
Type: TOTP
Secret: JBSWY3DPEHPK3PXP (from service)
Period: 30 seconds
Digits: 6
```

#### 🎫 API Token
```
Title: OpenAI API
Token: sk-proj-xxxxxxxxxxxxx
Type: API Token
Expires: 2024-12-31
```

#### 📝 Secure Note
```
Title: WiFi Passwords
Content: Your secure notes here
```

Click **"Save"** and you're done!

## 💡 Quick Tips

### Copying Data
Just click the **"Copy"** button next to any field. It's automatically cleared after 30 seconds.

### Searching
Type in the search bar at the top to instantly filter your entries.

### Filtering by Category
Click on the sidebar categories:
- **All** - Everything
- **Logins** - Website passwords
- **MFA** - 2FA codes
- **Tokens** - API keys
- **Notes** - Secure notes

### Backup Your Data
1. Go to **File** → **Export Backup**
2. Save the `.enc` file somewhere safe
3. Keep your master password safe too!

### Lock When Away
Click **"Lock"** button to protect your data when stepping away.

### Dark Mode
Click the moon/sun icon to toggle themes.

## 🔒 Security Quick Facts

✅ **AES-256** encryption
✅ **100,000** PBKDF2 iterations
✅ **No cloud** - everything stays on your device
✅ **Auto-lock** available
✅ **Clipboard** auto-clears after 30s

## 🆘 Common Issues

### Forgot Master Password?
⚠️ **There's no recovery** - you'll need to reset and lose all data.
Click "Forgot Password" → Type "RESETAR" → Start fresh.

**Prevention:** Always keep a backup!

### MFA Codes Not Working?
Check your system time is synchronized:
```bash
# Linux
timedatectl status

# Windows
w32tm /query /status
```

### Can't Open App?
Make sure you have Node.js 16+ installed:
```bash
node --version
```

## 📚 Next Steps

- Read the full [README.md](README.md) for detailed features
- Check [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) to contribute
- Import your existing MFA codes (see JSON format in README)

## 🔗 Useful Shortcuts

| Action | Shortcut |
|--------|----------|
| Lock App | Click "Lock" button |
| Search | Type in search bar |
| Add Entry | Click "Add" button |
| Toggle Theme | Click moon/sun icon |
| Export Backup | File → Export |
| Import Backup | File → Import |

## 🎯 Use Cases

### For Personal Use
- Store all your passwords
- Manage 2FA codes
- Keep API keys safe
- Store recovery codes
- Save secure notes

### For Developers
- Store API keys
- Save JWT tokens
- Keep SSH keys
- Store database credentials
- Manage OAuth tokens

### For Business
- Share team credentials (export/import)
- Store client information
- Keep license keys
- Save important notes

## ⚡ Pro Tips

1. **Regular Backups**: Export backup weekly to external drive
2. **Strong Master Password**: Use a passphrase like "correct-horse-battery-staple"
3. **Organize with Names**: Use clear titles like "GitHub Work Account"
4. **Use Notes Field**: Add context like "Created: 2024-01-15, Used for: Production"
5. **Test Your Backup**: Import to verify it works before you need it

## 🆕 Import Existing MFA Codes

Have MFA codes from another app? Create a JSON file:

```json
[
  {
    "title": "Google",
    "secret": "JBSWY3DPEHPK3PXP",
    "algorithm": "totp",
    "period": 30,
    "digits": 6,
    "hash": "sha1"
  },
  {
    "title": "GitHub",
    "secret": "ANOTHER5SECRETKEY",
    "algorithm": "totp",
    "period": 30,
    "digits": 6,
    "hash": "sha1"
  }
]
```

Then: Click **"Import"** → Select file → Confirm

## 📞 Need Help?

1. Check the [README.md](README.md) troubleshooting section
2. Look at [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for technical details
3. Open an issue on GitHub with:
   - What you tried to do
   - What happened instead
   - Your OS and Node.js version

---

**That's it! You're ready to securely manage your secrets. 🎉**

Remember: Your security is only as strong as your master password. Choose wisely!


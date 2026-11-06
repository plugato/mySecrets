# Installation Guide - MySecrets

Detailed installation instructions for all supported platforms.

## Table of Contents

- [System Requirements](#system-requirements)
- [Linux Installation](#linux-installation)
- [Windows Installation](#windows-installation)
- [Building from Source](#building-from-source)
- [Post-Installation](#post-installation)
- [Uninstallation](#uninstallation)
- [Troubleshooting](#troubleshooting)

## System Requirements

### Minimum Requirements

| Component | Requirement |
|-----------|-------------|
| **OS** | Windows 10+ / Linux (Ubuntu 18.04+, Fedora 30+, Debian 10+) |
| **RAM** | 512 MB |
| **Disk Space** | 200 MB |
| **Display** | 1024x768 resolution |

### Recommended Requirements

| Component | Requirement |
|-----------|-------------|
| **OS** | Windows 11 / Ubuntu 22.04+ / Fedora 38+ |
| **RAM** | 1 GB or more |
| **Disk Space** | 500 MB |
| **Display** | 1920x1080 resolution |

### For Development

| Component | Requirement |
|-----------|-------------|
| **Node.js** | v16.0.0 or higher |
| **npm** | v8.0.0 or higher |
| **Git** | v2.20.0 or higher |
| **Build Tools** | gcc, make (Linux) / Visual Studio Build Tools (Windows) |

## Linux Installation

### Method 1: AppImage (Recommended)

AppImage is a universal package format that works on most Linux distributions.

#### Ubuntu/Debian/Linux Mint

```bash
# 1. Download the AppImage
wget https://github.com/your-repo/mysecrets/releases/latest/download/MySecrets-1.0.0.AppImage

# 2. Make it executable
chmod +x MySecrets-1.0.0.AppImage

# 3. (Optional) Move to applications directory
sudo mv MySecrets-1.0.0.AppImage /opt/mysecrets/
sudo ln -s /opt/mysecrets/MySecrets-1.0.0.AppImage /usr/local/bin/mysecrets

# 4. Run
./MySecrets-1.0.0.AppImage
# or if moved:
mysecrets
```

#### Fedora/RHEL/CentOS

```bash
# 1. Download the AppImage
curl -L -o MySecrets-1.0.0.AppImage https://github.com/your-repo/mysecrets/releases/latest/download/MySecrets-1.0.0.AppImage

# 2. Make it executable
chmod +x MySecrets-1.0.0.AppImage

# 3. Run
./MySecrets-1.0.0.AppImage
```

#### Arch Linux

```bash
# Download and run
wget https://github.com/your-repo/mysecrets/releases/latest/download/MySecrets-1.0.0.AppImage
chmod +x MySecrets-1.0.0.AppImage
./MySecrets-1.0.0.AppImage
```

### Method 2: .deb Package (Debian-based)

```bash
# 1. Download .deb file
wget https://github.com/your-repo/mysecrets/releases/latest/download/mysecrets_1.0.0_amd64.deb

# 2. Install
sudo dpkg -i mysecrets_1.0.0_amd64.deb

# 3. Fix dependencies if needed
sudo apt-get install -f

# 4. Run
mysecrets
```

### Method 3: .rpm Package (Red Hat-based)

```bash
# 1. Download .rpm file
wget https://github.com/your-repo/mysecrets/releases/latest/download/mysecrets-1.0.0.x86_64.rpm

# 2. Install (Fedora)
sudo dnf install ./mysecrets-1.0.0.x86_64.rpm

# Or (RHEL/CentOS)
sudo yum localinstall mysecrets-1.0.0.x86_64.rpm

# 3. Run
mysecrets
```

### Desktop Integration (Optional)

Create a desktop entry for easy access:

```bash
# Create desktop entry
cat > ~/.local/share/applications/mysecrets.desktop << EOF
[Desktop Entry]
Name=MySecrets
Comment=Secure Password and MFA Manager
Exec=/path/to/MySecrets-1.0.0.AppImage
Icon=/path/to/icon.png
Terminal=false
Type=Application
Categories=Utility;Security;
EOF

# Update desktop database
update-desktop-database ~/.local/share/applications/
```

## Windows Installation

### Method 1: Installer (Recommended)

1. **Download the installer**
   - Go to [Releases](https://github.com/your-repo/mysecrets/releases/latest)
   - Download `MySecrets-Setup-1.0.0.exe`

2. **Run the installer**
   - Double-click `MySecrets-Setup-1.0.0.exe`
   - If Windows SmartScreen appears, click "More info" → "Run anyway"

3. **Follow installation wizard**
   - Choose installation directory (default: `C:\Program Files\MySecrets`)
   - Select if you want desktop shortcut
   - Select if you want Start Menu shortcut
   - Click "Install"

4. **Launch**
   - From desktop shortcut
   - From Start Menu
   - Or run from installation directory

### Method 2: Portable Version

1. **Download portable ZIP**
   ```
   MySecrets-1.0.0-win-portable.zip
   ```

2. **Extract to desired location**
   ```
   Right-click → Extract All → Choose location
   ```

3. **Run**
   ```
   Double-click MySecrets.exe
   ```

### Installation Options

During installation, you can customize:

- **Installation Directory**: Choose where to install (default: Program Files)
- **Desktop Shortcut**: Add icon to desktop
- **Start Menu**: Add to Start Menu
- **Launch on Startup**: (Not currently implemented)

### Silent Installation

For system administrators:

```cmd
# Install silently
MySecrets-Setup-1.0.0.exe /S

# Install to custom directory
MySecrets-Setup-1.0.0.exe /S /D=C:\CustomPath\MySecrets

# Uninstall silently
Uninstall.exe /S
```

## Building from Source

### Prerequisites

Install required tools:

#### Linux

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y nodejs npm git build-essential

# Fedora
sudo dnf install nodejs npm git gcc-c++ make

# Arch
sudo pacman -S nodejs npm git base-devel
```

#### Windows

1. Install [Node.js](https://nodejs.org/) (includes npm)
2. Install [Git](https://git-scm.com/download/win)
3. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)

### Clone and Build

```bash
# 1. Clone repository
git clone https://github.com/your-repo/mysecrets.git
cd mysecrets

# 2. Install dependencies
npm install

# 3. Run in development mode
npm run dev

# 4. Build for production
# Linux
npm run build-linux

# Windows
npm run build-win

# Both
npm run build
```

### Build Output

Compiled applications will be in `dist/` directory:

```
dist/
├── MySecrets-1.0.0.AppImage          # Linux AppImage
├── mysecrets_1.0.0_amd64.deb         # Debian package
├── mysecrets-1.0.0.x86_64.rpm        # RPM package
├── MySecrets-Setup-1.0.0.exe         # Windows installer
└── win-unpacked/                     # Windows portable
```

### Custom Build Options

Edit `package.json` to customize:

```json
{
  "build": {
    "appId": "com.yourcompany.mysecrets",
    "productName": "MySecrets Custom",
    "compression": "maximum",
    "linux": {
      "target": ["AppImage", "deb", "rpm", "snap"],
      "category": "Utility"
    },
    "win": {
      "target": ["nsis", "portable"],
      "icon": "assets/custom-icon.ico"
    }
  }
}
```

Then build:
```bash
npm run build
```

## Post-Installation

### First Launch

1. **Linux**: The app may take a few seconds to start on first launch
2. **Windows**: Windows Defender may scan the app (this is normal)

### Create Master Password

On first launch:
1. You'll see the setup screen
2. Create a strong master password (minimum 8 characters, recommended 12+)
3. Confirm your password
4. Click "Create Vault"

⚠️ **Important**: There is no password recovery. If you forget your master password, all data will be lost.

### Data Location

Your encrypted data is stored at:

| Platform | Location |
|----------|----------|
| **Linux** | `~/.config/mysecrets/secrets.enc` |
| **Windows** | `%APPDATA%\mysecrets\secrets.enc` |

### Backup Your Data

**Immediately after setup:**

1. Open MySecrets
2. Go to File → Export Backup
3. Save to a secure location (USB drive, encrypted cloud storage)
4. Store your master password separately and securely

## Uninstallation

### Linux

#### AppImage
```bash
# Simply delete the file
rm MySecrets-1.0.0.AppImage

# Remove data (optional)
rm -rf ~/.config/mysecrets
```

#### Debian Package
```bash
sudo apt-get remove mysecrets
# or to remove with configuration
sudo apt-get purge mysecrets
```

#### RPM Package
```bash
sudo dnf remove mysecrets
# or
sudo yum remove mysecrets
```

### Windows

#### Via Installer
1. Open Settings → Apps
2. Find "MySecrets"
3. Click Uninstall

#### Via Control Panel
1. Control Panel → Programs → Uninstall a program
2. Select "MySecrets"
3. Click Uninstall

#### Command Line
```cmd
# Run uninstaller directly
"C:\Program Files\MySecrets\Uninstall.exe"

# Silent uninstall
"C:\Program Files\MySecrets\Uninstall.exe" /S
```

### Remove User Data

After uninstalling, your encrypted data remains. To remove:

**Linux:**
```bash
rm -rf ~/.config/mysecrets
```

**Windows:**
```cmd
rmdir /s "%APPDATA%\mysecrets"
```

⚠️ **Warning**: This permanently deletes all your stored passwords and MFA codes.

## Troubleshooting

### Linux Issues

#### AppImage Won't Run

**Problem**: `cannot execute binary file`

**Solution**:
```bash
# Make sure it's executable
chmod +x MySecrets-1.0.0.AppImage

# Check if FUSE is installed
sudo apt-get install fuse libfuse2

# Or extract and run
./MySecrets-1.0.0.AppImage --appimage-extract
./squashfs-root/AppRun
```

#### Missing Libraries

**Problem**: `error while loading shared libraries`

**Solution**:
```bash
# Ubuntu/Debian
sudo apt-get install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0

# Fedora
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-atk libuuid libsecret
```

#### Wayland Issues

**Problem**: Blank window or crashes on Wayland

**Solution**:
```bash
# Run with X11 backend
GDK_BACKEND=x11 ./MySecrets-1.0.0.AppImage
```

### Windows Issues

#### SmartScreen Warning

**Problem**: "Windows protected your PC" message

**Solution**:
1. Click "More info"
2. Click "Run anyway"

This appears because the app isn't signed with an expensive code signing certificate.

#### Antivirus False Positive

**Problem**: Antivirus blocks installation

**Solution**:
1. Temporarily disable antivirus
2. Install MySecrets
3. Add to antivirus whitelist
4. Re-enable antivirus

This is common with Electron apps and is a false positive.

#### Installation Error

**Problem**: "Installation failed" or "Access denied"

**Solution**:
1. Run installer as Administrator:
   - Right-click → "Run as administrator"
2. Choose different installation directory
3. Check disk space (need at least 500 MB)

#### Won't Start

**Problem**: Nothing happens when clicking icon

**Solution**:
```cmd
# Check if already running
tasklist | findstr MySecrets

# Kill if necessary
taskkill /F /IM MySecrets.exe

# Check Event Viewer for errors
eventvwr.msc
```

### Build Issues

#### npm install Fails

**Problem**: Error during `npm install`

**Solution**:
```bash
# Clear npm cache
npm cache clean --force

# Delete and reinstall
rm -rf node_modules package-lock.json
npm install

# Use specific Node version
nvm install 16
nvm use 16
npm install
```

#### electron-builder Fails

**Problem**: Error during build

**Solution**:
```bash
# Install system dependencies (Linux)
sudo apt-get install -y rpm

# For Wine (Windows builds on Linux)
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install wine64 wine32

# Clean build directory
rm -rf dist/
npm run build
```

#### Out of Memory

**Problem**: JavaScript heap out of memory

**Solution**:
```bash
# Increase Node memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

### Permission Issues

#### Can't Save Data

**Problem**: "Failed to save data" error

**Solution**:
```bash
# Linux - Fix permissions
chmod 700 ~/.config/mysecrets
chmod 600 ~/.config/mysecrets/secrets.enc

# Windows - Run as administrator or check folder permissions
```

#### Can't Create Directories

**Problem**: "EACCES: permission denied, mkdir"

**Solution**:
```bash
# Linux
sudo chown -R $USER:$USER ~/.config/mysecrets

# Windows - Disable folder protection:
# Settings → Update & Security → Windows Security → Virus & threat protection
# → Manage ransomware protection → Allow app through Controlled folder access
```

## Upgrading

### Linux

#### AppImage
1. Download new version
2. Replace old AppImage
3. Run new version
4. Your data is preserved automatically

#### Package Managers
```bash
# Debian
sudo dpkg -i mysecrets_1.1.0_amd64.deb

# Fedora
sudo dnf upgrade mysecrets-1.1.0.x86_64.rpm
```

### Windows

1. Download new installer
2. Run installer (it will detect old version)
3. Choose "Install" to upgrade
4. Your data is preserved automatically

### Data Migration

When upgrading, your data at `~/.config/mysecrets/secrets.enc` (Linux) or `%APPDATA%\mysecrets\secrets.enc` (Windows) is automatically preserved.

**Recommended before upgrading:**
1. Export backup: File → Export Backup
2. Install new version
3. Verify everything works
4. Keep backup for a few days

## Verification

### Verify Installation

**Linux:**
```bash
# Check if installed
which mysecrets

# Check version (if implemented)
mysecrets --version

# Check data directory
ls -la ~/.config/mysecrets
```

**Windows:**
```cmd
# Check if installed
where mysecrets

# Check installation directory
dir "C:\Program Files\MySecrets"

# Check data directory
dir "%APPDATA%\mysecrets"
```

### Verify Integrity (Advanced)

If you want to verify the download wasn't tampered with:

```bash
# Download checksums file
wget https://github.com/your-repo/mysecrets/releases/latest/download/SHASUMS256.txt

# Verify (Linux)
sha256sum -c SHASUMS256.txt

# Verify (Windows)
certutil -hashfile MySecrets-Setup-1.0.0.exe SHA256
```

## Support

If you encounter issues not covered here:

1. Check the [main README](../../README.md) troubleshooting section
2. Search [existing issues](https://github.com/your-repo/mysecrets/issues)
3. Open a [new issue](https://github.com/your-repo/mysecrets/issues/new) with:
   - Your OS and version
   - Installation method used
   - Complete error message
   - Steps to reproduce

## Next Steps

- Read [QUICK_START.md](../../QUICK_START.md) to learn basic usage
- See [README.md](../../README.md) for complete feature documentation
- Check [DEVELOPER_GUIDE.md](../developer/DEVELOPER_GUIDE.md) if you want to contribute

---

Happy securing! 🔒


# 🪟 Windows Installer / Portable Build Guide (Windows 11 Pro)

Build a signed Windows installer (.exe) or portable executable for **Dylando Ultimate Credit Repair Suite** on **Windows 11 Pro** (or any Windows 10/11 with Node.js).

## Prerequisites (Windows 11 Pro)

1. **Node.js 18+** — Download from [nodejs.org](https://nodejs.org/) (LTS recommended)
   - Verify: `node --version` → v18.x or higher
   - Verify: `npm --version` → v9.x or higher
2. **Git** (optional, for version control) — [git-scm.com](https://git-scm.com/)
3. **Code signing certificate** (optional — for production signed builds)
4. **Minimum**: 4GB RAM, 500MB free disk space

## Quick Build (Windows 11 Pro)

### Step 1: Open Terminal
Open **PowerShell** or **Command Prompt** as Administrator (right-click → Run as administrator).

> **Why Administrator?** Electron-builder's NSIS installer needs admin rights to write to `Program Files`. For portable builds, you don't need admin.

### Step 2: Install Dependencies
```powershell
cd C:\path\to\dylando-ultimate-credit-repair-suite
npm install
```

> **Troubleshooting**: If `node-gyp` errors appear, install Windows Build Tools:
> ```powershell
> npm install --global windows-build-tools
> ```

### Step 3: Build the Web App for Electron
```powershell
npm run build:electron
```
This outputs to `dist/` — the production-ready web layer for Electron.

### Step 4: Package as Windows Installer (EXE)

#### Option A: NSIS Installer (Recommended for Windows 11 Pro)
```powershell
npx electron-builder --config electron-builder.json --win --x64
```

Output: `release/Dylando Ultimate Credit Repair Suite Setup {version}.exe`

#### Option B: Portable EXE (No Install Needed)
```powershell
npx electron-builder --config electron-builder.json --win portable --x64
```

Output: `release/Dylando Ultimate Credit Repair Suite Portable {version}.exe`

#### Option C: Unpacked Directory (For Debugging)
```powershell
npx electron-builder --config electron-builder.json --win dir --x64
```

Output: `release/win-unpacked/` — run `Dylando Ultimate Credit Repair Suite.exe` directly.

### Step 5: Install and Run
1. Double-click the `.exe` in `release/`
2. NSIS installer: follow the setup wizard (defaults: Desktop shortcut + Start Menu)
3. Launch from Desktop shortcut or Start Menu

## Code Signing (Windows 11 Pro)

For production builds that don't show "Unknown publisher":

### Get a Certificate
- **OV Code Signing** (~$200-300/year): DigiCert, Sectigo, GlobalSign
- **EV Code Signing** (~$300-500/year): Instant reputation, less SmartScreen blocks
- **Self-signed** (free, for personal use): Use PowerShell:

```powershell
New-SelfSignedCertificate -Type Custom -Subject "CN=DylandOs, O=DylandOs, C=US" `
  -KeyUsage DigitalSignature -FriendlyName "DylandOs Code Signing" `
  -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
```
Export the certificate as `.pfx` and reference it in electron-builder.json.

### Sign the Build
```powershell
# Set certificate path (use full path)
$env:CSC_LINK = "C:\path\to\certificate.p12"
$env:CSC_KEY_PASSWORD = "your_certificate_password"

npx electron-builder --config electron-builder.json --win --x64
```

## Windows 11 Pro-Specific Notes

### Antivirus False Positives
Windows Defender and third-party AVs sometimes flag new unsigned executables. The first few users of a new binary may see SmartScreen warnings. This is normal and resolves as more users download it (reputation builds). Code signing eliminates this.

### Squirrel vs NSIS
The project uses **NSIS** (Nullsoft Scriptable Install System) — the most reliable installer for Windows. It supports:
- Per-user installation (no admin required)
- Desktop and Start Menu shortcuts
- Uninstall through Windows Settings → Apps
- Custom install directory

### Building on ARM64 Windows
If running Windows 11 Pro on ARM (Surface Pro X, etc.), electron-builder automatically detects the architecture. Built x64 packages run via x64 emulation on ARM64 Windows.

### Windows Sandbox Testing
To test the installer in a clean Windows environment:
1. Open **Windows Features** → Turn on **Windows Sandbox**
2. Launch Windows Sandbox from Start Menu
3. Copy the installer into the sandbox window
4. Install and test without affecting your main system

### Electron Security
- `safeStorage` uses **Windows DPAPI** (encrypted with your Windows login credentials)
- App data stored at: `%APPDATA%/Dylando Ultimate Credit Repair Suite/`
- Cache stored at: `%LOCALAPPDATA%/Dylando Ultimate Credit Repair Suite/`

## Troubleshooting (Windows 11 Pro)

| Issue | Fix |
|-------|------|
| `electron-builder` not found | `npx electron-builder` or install globally: `npm i -g electron-builder` |
| Build fails on `electron:dist` | Run `npm run build:electron` first (must succeed before packaging) |
| Icon not found | `electron/icon.ico` must exist — already provided in the project |
| `safeStorage` unavailable | Windows DPAPI requires a user profile with a login password |
| `node-gyp` rebuild errors | Install Visual Studio Build Tools: `npm install --global windows-build-tools` |
| NSIS script execution failed | Reinstall NSIS: download from [nsis.sourceforge.io](https://nsis.sourceforge.io/Download) |
| `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` | Windows Defender may have blocked it. Add exclusion in Windows Security → Virus & threat protection → Manage exclusions |
| App shows blank white screen | Run `npm run build:electron` again — web assets may be stale |
| `electron:build` hangs at "Building NSIS installer" | Close any open File Explorer windows pointing to `release/` — NSIS needs exclusive write access |

## Build Script Reference

```powershell
# Full production build
npm run build:electron && npx electron-builder --config electron-builder.json --win --x64

# Quick development build (unpacked — no installer)
npm run build:electron && npx electron-builder --config electron-builder.json --win dir --x64

# Portable single-file EXE
npm run build:electron && npx electron-builder --config electron-builder.json --win portable --x64

# Build with logging for debugging
npx electron-builder --config electron-builder.json --win --x64 --verbose
```

# 🤖 Android Signed Release APK Guide

Build a signed, production-ready Android APK for **Dylando Ultimate Credit Repair Suite**.

> **Note**: The primary platform is Windows via Electron. Android is a secondary platform.  
> Build the Android APK on **Windows 11 Pro** with Android Studio for best results.

## Prerequisites (Windows 11 Pro)

| Tool | Version | Where to Get It |
|------|---------|----------------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| Android Studio | 2024.x+ | [developer.android.com/studio](https://developer.android.com/studio) |
| Java | 17+ | Bundled with Android Studio |
| Android SDK | API 34+ | SDK Manager in Android Studio |
| Gradle | 8.x+ | Bundled with Android project |

### Initial Android Studio Setup (First Time Only)

1. Install **Android Studio** (default settings)
2. Open Android Studio → **SDK Manager** (🔧 icon in top right)
3. Install:
   - **Android SDK Platform 34**
   - **Android SDK Build-Tools 34+**
   - **Android SDK Command-line Tools** (latest)
4. Set environment variable (PowerShell as Admin):
   ```powershell
   [Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
   ```
5. Restart PowerShell/Terminal

## Quick Build (Windows 11 Pro)

```powershell
# 1. Install JS dependencies
cd C:\path\to\dylando-ultimate-credit-repair-suite
npm install

# 2. Build the Vite web app
npm run build

# 3. Sync web build to Capacitor Android project
npx cap sync android

# 4. Generate release APK
cd android
.\gradlew assembleRelease
```

Output: `android\app\build\outputs\apk\release\app-release.apk`

## Creating a Keystore (First Time Only)

If you don't have a signing keystore, create one on **Windows 11 Pro**:

```powershell
# Make sure Java is accessible (should be if Android Studio is installed)
# Find keytool.exe: usually at C:\Program Files\Android\Android Studio\jbr\bin\
# Add to PATH if not found:
$env:Path += ";C:\Program Files\Android\Android Studio\jbr\bin"

keytool -genkey -v -keystore android\app\dylandos-release.jks `
  -alias dylandos -keyalg RSA -keysize 2048 -validity 10000 `
  -storetype JKS `
  -dname "CN=DylandOs, OU=Development, O=DylandOs, L=City, C=US"
```

You'll be prompted for:
- **Keystore password** — remember this! (min 6 characters)
- **Key password** — can be same as keystore password

> **⚠️ CRITICAL**: Back up the keystore file (`dylandos-release.jks`) to a secure location.  
> If you lose it, you cannot update your app on the Play Store with the same package name.

## Setting Signing Credentials

Set these environment variables **before** building (PowerShell):

```powershell
# REQUIRED for signed release build
$env:DYLANDOS_STORE_FILE = "dylandos-release.jks"
$env:DYLANDOS_STORE_PASSWORD = "your_keystore_password"
$env:DYLANDOS_KEY_ALIAS = "dylandos"
$env:DYLANDOS_KEY_PASSWORD = "your_key_password"

# Optional: Android update manifest URL (for in-app update checking)
$env:DYLANDOS_ANDROID_UPDATE_MANIFEST_URL = "https://gist.githubusercontent.com/..."
$env:DYLANDOS_ANDROID_UPDATE_CHANNEL = "stable"
```

Then build:
```powershell
npm run build && npx cap sync android && cd android && .\gradlew assembleRelease
```

## Windows 11 Pro-Specific Notes

### PowerShell Execution Policy
If you get "running scripts is disabled on this system", run:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### Long Path Support
Windows 11 Pro has a 260-character path limit for some tools. Enable long paths:
```powershell
# Enable long path support in git (if using git)
git config --system core.longpaths true

# Enable via Windows Group Policy (Pro only)
# Or run as Admin:
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

### Android SDK Path Issues
If Gradle can't find the Android SDK:
```powershell
# Check where SDK is installed
ls "$env:LOCALAPPDATA\Android\Sdk"

# Or create a local.properties file manually
echo "sdk.dir=$env:LOCALAPPDATA\Android\Sdk" > android\local.properties
```

### Anti-Virus Exclusions
Windows Defender may slow down Gradle builds. Add exclusions:
```powershell
# Add exclusion for the project's android folder
Add-MpPreference -ExclusionPath "C:\path\to\dylando-ultimate-credit-repair-suite\android"
```

### Speeding Up Gradle on Windows 11 Pro
```powershell
# Enable Gradle daemon (persistent between builds)
echo "org.gradle.daemon=true" >> android\gradle.properties
echo "org.gradle.parallel=true" >> android\gradle.properties
echo "org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m" >> android\gradle.properties
```

## Alternative: Build with Android Studio

```powershell
# Sync first
npm run build && npx cap sync android

# Open in Android Studio
npx cap open android
```

In Android Studio:
1. Wait for Gradle sync to finish (bottom right — may take 2-5 minutes first time)
2. Go to **Build → Generate Signed Bundle / APK**
3. Select **APK**
4. Load your keystore file (`android/app/dylandos-release.jks`)
5. Enter keystore/key passwords
6. Select **release** build variant
7. Select **V1 (Jar Signature)** and **V2 (Full APK Signature)** 
8. Click **Finish**
9. APK will be at `android/app/build/outputs/apk/release/app-release.apk`

## Installing the APK on Your Device

### Via USB Debugging (Windows 11 Pro)
```powershell
# 1. Enable Developer options on your Android phone:
#    Settings → About phone → Tap "Build number" 7 times

# 2. Enable USB debugging:
#    Settings → Developer options → USB debugging

# 3. Connect phone via USB — accept the RSA fingerprint prompt

# 4. Verify connection:
cd android
.\gradlew installDebug
# OR for release:
.\gradlew installRelease
```

### Manual Install
1. Copy `android/app/build/outputs/apk/release/app-release.apk` to your phone
2. On phone: open File Manager → navigate to the APK
3. Tap to install — you may need to allow "Install from unknown sources"
4. The app will appear as "Dylandos" in your app drawer

### Sideload via ADB
```powershell
# If you have ADB in PATH:
adb install android\app\build\outputs\apk\release\app-release.apk
```

## Troubleshooting (Windows 11 Pro)

| Issue | Fix |
|-------|------|
| `FAILURE: Build failed with exception` — missing SDK | Run Android Studio SDK Manager → install Platform 34 |
| `Keystore was tampered with, or password was incorrect` | Check env vars `DYLANDOS_STORE_PASSWORD` and `DYLANDOS_KEY_PASSWORD` — they must match exactly what you entered during `keytool` |
| `Android project not found` | Run `npm run cap:sync` first (which runs `npx cap sync android`) |
| `Android project not initialized` | Run `npx cap add android` once |
| `app-release-unsigned.apk` instead of signed | You forgot to set signing env vars. Set `DYLANDOS_STORE_FILE` etc. before building |
| APK installs but crashes on launch | Run `npx cap sync android` and rebuild — web assets may be stale |
| `FAILED: build-scan-publisher` | Gradle plugin compatibility issue — update Gradle wrapper: `cd android && .\gradlew wrapper --gradle-version 8.7` |
| `Could not find com.android.tools.build:gradle` | Update `android/build.gradle` to use latest AGP version |
| `Unable to make field private final java.lang.String java.io.File.path accessible` | Java 17 issue — add `--add-opens java.base/java.io=ALL-UNNAMED` to `GRADLE_OPTS` |
| Build takes >10 minutes | First build is slow (downloads dependencies). Subsequent builds with daemon are ~30-60 seconds |
| `NoConnectedDeviceException` during install | Make sure USB debugging is enabled and the device is unlocked |

## Build Output Reference

| File | Location | Purpose |
|------|----------|---------|
| `app-release.apk` | `android/app/build/outputs/apk/release/` | Signed release APK — install on any Android 8+ device |
| `app-release-unsigned.apk` | Same directory (if no signing) | Unsigned — cannot be installed directly |
| `app-debug.apk` | `android/app/build/outputs/apk/debug/` | Debug APK — signed with debug keystore, for testing |

## Play Store Release (Optional)

To publish on Google Play Store:
1. Build signed release APK (steps above)
2. Go to [play.google.com/console](https://play.google.com/console/)
3. Pay $25 one-time developer registration fee
4. Create new app → Upload APK
5. Fill in store listing (screenshots, description, privacy policy)
6. Submit for review (typically 1-3 days for first release)

# Building the Installers & Backing Up the App

**Dylando Ultimate Credit Repair Suite — v5.6.3**
Last updated: August 1, 2026

This guide covers how to create the distributable executables (Windows + Android)
and how to keep a full backup of the app source code.

---

## 1. One-time machine setup (your PC)

| Tool | Where to get it | Needed for |
|---|---|---|
| Node.js 20+ (LTS) | https://nodejs.org | Everything |
| Git | https://git-scm.com | Cloning / pulling the code |
| JDK 17 | https://adoptium.net | Android builds |
| Android Studio (with Android SDK) | https://developer.android.com/studio | Android APK/AAB |

> The Windows installer builds natively on Windows. No Wine, no code-signing
> certificate is required — `electron-builder.json` already sets
> `signAndEditExecutable: false`.

## 2. Get the code onto your machine

```powershell
git clone https://github.com/dylan42000/newdeepdiveupgradedattempt1testingone.git
cd newdeepdiveupgradedattempt1testingone
git checkout arena/019fbbb1-newdeepdiveupgradedattempt1tes
npm ci
```

(If you already have the folder, just run `git pull` then `npm ci` inside it.)

## 3. Windows executables (.exe)

From the project folder in PowerShell/Terminal:

```powershell
npm run electron:build
```

That single command (1) bundles the app with the Electron target and
(2) packages it with electron-builder. Output lands in the `release/` folder:

| File | What it is |
|---|---|
| `Dylando Ultimate Credit Repair Suite Setup 5.6.3.exe` | Full installer (NSIS, choose install dir, desktop + Start Menu shortcuts) |
| `Dylando Ultimate Credit Repair Suite Portable 5.6.3.exe` | Single portable .exe — runs without installing, ideal for backups/USB |
| `win-unpacked/` | Raw app folder — run the `.exe` inside directly |

First run downloads the Electron + NSIS tooling (~150 MB) and caches it in
`%LOCALAPPDATA%\electron-builder\Cache` — subsequent builds are fast.

**Copy the Setup and Portable .exe files somewhere safe (external drive /
cloud).** The `release/` folder is git-ignored, so GitHub is NOT a backup for
these binaries — you must copy them yourself.

## 4. Android app (APK / AAB)

```powershell
npm run cap:sync      # builds the web bundle and syncs it into android/
npm run cap:open      # opens the project in Android Studio
```

Then in Android Studio:

* **Debug APK for personal backup:** `Build > Build App Bundle(s)/APK(s) > Build APK(s)`
  → output: `android/app/build/outputs/apk/debug/app-debug.apk`
* **Signed release (recommended, uses the keystore config already in
  `capacitor.config.ts`):** set these environment variables first —

```powershell
$env:DYLANDOS_STORE_FILE="C:\path\to\dylandos-release.jks"
$env:DYLANDOS_STORE_PASSWORD="your-store-password"
$env:DYLANDOS_KEY_ALIAS="dylandos"
$env:DYLANDOS_KEY_PASSWORD="your-key-password"
```

  then `Build > Generate Signed App Bundle/APK > APK` (or AAB for Play Store).

**Back up the keystore file (`dylandos-release.jks`) and its passwords
separately.** Without them you can never update an installed release build.

## 5. Backing up the full app

You get three layers of backup — use all of them:

1. **GitHub (automatic):** all source code, docs, and tests live in the repo
   branch `arena/019fbbb1-newdeepdiveupgradedattempt1tes`.
   Download a complete copy any time from GitHub:
   **Code → Download ZIP**, or:

   ```powershell
   git clone https://github.com/dylan42000/newdeepdiveupgradedattempt1testingone.git dylando-backup
   ```

2. **Local archive:** after cloning, make an offline copy:

   ```powershell
   Compress-Archive -Path .\newdeepdiveupgradedattempt1testingone -DestinationPath .\dylando-backup-$(Get-Date -Format yyyy-MM-dd).zip
   ```

   (`node_modules/`, `dist/`, `release/`, and Android build folders are
   git-ignored regeneratable outputs — the zip stays small.)

3. **Binaries:** copy the `release/*.exe` installers and your signed APK to an
   external drive or cloud storage, as described above. These are never in Git.

## 6. Verify before shipping

```powershell
npm run lint        # TypeScript must be clean
npm run test:all    # all 5 regression suites must pass
npm run build       # web bundle sanity check
```

If all three pass, `npm run electron:build` output is safe to distribute.

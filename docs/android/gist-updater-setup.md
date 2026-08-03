# Android Gist Updater Setup

This app now supports a Gist-driven Android update feed.

## 1) Create the Manifest Gist

1. Create a new public Gist.
2. Add one file named `dylandos-android-update.json`.
3. Paste the schema from `docs/android/gist-update-manifest-template.json`.
4. Replace `apkUrl` with your Dropbox direct APK link (`?dl=1`).
5. Bump `latestVersion` and `latestVersionCode` for each release.

## 2) Use the Raw Gist URL in App Settings

1. Open `Settings` -> `ANDROID UPDATE FEED (GIST)`.
2. Paste the raw URL from your Gist file (must return JSON directly).
3. Click `SAVE FEED URL`.
4. Click `CHECK NOW`.

## 3) Release Workflow

1. Build signed APK.
2. Upload APK to Dropbox.
3. Copy Dropbox direct link (`?dl=1`).
4. Update only the Gist JSON values:
   - `latestVersion`
   - `latestVersionCode`
   - `apkUrl`
   - `releaseNotes`
5. Save Gist. Existing installs can discover the new APK via `CHECK NOW` or startup auto-check.

## Notes

- The updater compares app version using semantic version logic.
- `mandatory` is currently informational in UI and can be enforced later.
- Use HTTPS links only.

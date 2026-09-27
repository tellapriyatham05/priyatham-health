# Build from source

[← Back to README](../README.md)

- [Requirements](#requirements)
- [Get the code](#get-the-code)
- [Preview the UI in a browser](#preview-the-ui-in-a-browser)
- [Build the Android app](#build-the-android-app)
- [Signing](#signing)
- [Install on a phone over USB](#install-on-a-phone-over-usb)
- [Change the logo](#change-the-logo)
- [Project scripts](#project-scripts)
- [Troubleshooting](#troubleshooting)

---

## Requirements

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | 20 or newer | Capacitor 7 CLI. (Capacitor 8 needs Node 22.) |
| **JDK** | 21 | e.g. [Eclipse Temurin 21](https://adoptium.net) |
| **Android SDK** | `platforms;android-35`, `build-tools;35.0.0`, `platform-tools` | Android Studio installs these, or use the [command-line tools](https://developer.android.com/studio#command-tools) |
| Python 3 + Pillow | optional | Only to regenerate the logo/icons (`tools/make_logo.py`) |

### Command-line-only SDK setup (Windows example)

```powershell
# after unzipping the command-line tools into <sdk>\cmdline-tools\latest
$env:JAVA_HOME = "C:\path\to\jdk-21"
<sdk>\cmdline-tools\latest\bin\sdkmanager.bat --sdk_root=<sdk> --licenses
<sdk>\cmdline-tools\latest\bin\sdkmanager.bat --sdk_root=<sdk> "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

Then tell Gradle where the SDK is, in `android/local.properties` (use **forward slashes** on Windows):
```properties
sdk.dir=C:/Users/you/Android/Sdk
```

## Get the code

```bash
git clone https://github.com/tellapriyatham05/priyatham-health.git
cd priyatham-health
npm install
```

## Preview the UI in a browser

The UI in `www/` runs in any browser. Native features (alarms, GPS, steps, usage) fall back to simulated data.

```bash
cd www
python -m http.server 8765
# open http://localhost:8765 (use your browser's mobile/device mode)
```

## Build the Android app

```bash
npx cap sync android          # copies www/ into the Android project
cd android
./gradlew assembleDebug       # → app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease     # → app/build/outputs/apk/release/app-release.apk
```
On Windows use `gradlew.bat`. Always run `npx cap sync android` after changing anything in `www/`.

Before a release, bump `versionCode` (+1) and `versionName` in `android/app/build.gradle`.

## Signing

Release builds are signed when `android/keystore.properties` exists:

```properties
storeFile=priyatham-release.jks          # relative to android/app/
storePassword=********
keyAlias=priyatham
keyPassword=********
```

Create a keystore once:
```bash
keytool -genkeypair -v -keystore android/app/priyatham-release.jks -alias priyatham \
  -keyalg RSA -keysize 2048 -validity 10000
```

> 🔐 **Never commit the keystore or `keystore.properties`** (both are in `.gitignore`). Back them up somewhere safe. Android only installs an update if it's signed with the **same key** as the installed app. If you lose the key, users must uninstall and reinstall (and lose their data unless they made a backup).

## Install on a phone over USB

Enable *Developer options → USB debugging* on the phone, then:
```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## Change the logo

All icons (adaptive launcher icon, monochrome themed icon, notification icon, splash screens, `www/logo.svg`, `brand/*`) come from one script:
```bash
python tools/make_logo.py
```
Geometry and colours are constants at the top of the file.

## Project scripts

| Command | What it does |
|---|---|
| `npm run sync` | `cap sync android` |
| `npm run icons` | Regenerates the logo and every icon size |
| `npm run preview` | Serves `www/` at http://localhost:8765 |

## Troubleshooting

| Error | Fix |
|---|---|
| `The Capacitor CLI requires NodeJS >=22` | You have Capacitor 8 installed. This project pins Capacitor 7 (Node 20 is fine). Run `npm install` again. |
| `The filename, directory name, or volume label syntax is incorrect` | Backslashes in `local.properties`. Use `C:/...` forward slashes. |
| `SDK location not found` | Create `android/local.properties` with `sdk.dir=...`. |
| Web changes don't show up on the phone | Run `npx cap sync android` before building. |

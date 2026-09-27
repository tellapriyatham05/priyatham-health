# Install on Android

[← Back to README](../README.md)

Priyatham Health is installed from an **APK file** (it isn't on the Play Store). This takes about 3 minutes.

- [1. Download the APK](#1-download-the-apk)
- [2. Install it](#2-install-it)
- [3. First-time setup](#3-first-time-setup)
- [4. Battery settings (don't skip)](#4-battery-settings-dont-skip)
- [5. Updating to a new version](#5-updating-to-a-new-version)
- [6. Troubleshooting](#6-troubleshooting)

**Requirements:** Android 6.0 or newer. Tested for a OnePlus Nord CE4 (Android 14 / OxygenOS). A step counter and GPS are recommended. No smartwatch needed.

---

## 1. Download the APK

Pick one:

| Option | How |
|---|---|
| **Directly on the phone** *(easiest)* | Open this repo's **[Releases](https://github.com/priyathamtella/priyatham-health/releases/latest)** page in Chrome on your phone → tap **`PriyathamHealth-v1.1.apk`** under *Assets*. |
| **Google Drive / OneDrive** | Upload the APK from your PC → open the Drive/OneDrive app on the phone → tap the file → **Download**. |
| **USB cable** | Connect the phone, choose *File transfer*, copy the APK into `Download/`. |
| **Send it to yourself** | Telegram *Saved Messages* or email to yourself, then open it on the phone. |

## 2. Install it

1. Tap the downloaded APK (from the download notification or **Files → Downloads**).
2. Android says *"For your security, your phone is not allowed to install unknown apps from this source."*
   Tap **Settings** → turn on **Allow from this source** → go back.
3. Tap **Install**.
4. If **Google Play Protect** shows *"Unsafe app blocked"* or *"App scan recommended"*, tap **More details → Install anyway**. This appears for any app installed outside the Play Store.
5. Tap **Open**.

> 💡 After installing you can switch **Allow from this source** back off: *Settings → Apps → Special app access → Install unknown apps*.

## 3. First-time setup

1. **Welcome screen**: enter sex, age, height, weight and goal weight, plus your wake-up, sleep, work and workout times. Every reminder is timed from these.
2. **Set up your phone**: tap **Allow** on every row until each shows **✓ On**. Some rows open an Android settings page: switch the app on there, then press **Back**.

   | Permission | Why |
   |---|---|
   | Notifications | Reminders with Done / Snooze / +250 ml buttons |
   | Alarms & reminders | Rings at the exact minute |
   | Full-screen notifications | Big ringing alarm over the lock screen |
   | Ignore battery optimisation | Stops the system from killing alarms |
   | Physical activity | Step counting |
   | Location (while using) | GPS rides |
   | Usage access | Phone screen time (stays on the phone) |

3. Tap **Test alarm**. It rings in 5 seconds. Put the phone on **silent** and test again: it vibrates instead.
4. Tap **Start using the app**.

## 4. Battery settings (don't skip)

Many Android brands close background apps aggressively, and that silences alarms. On **OnePlus / OxygenOS**:

1. *Settings → Apps → App management → Priyatham Health → Battery* (or *Battery usage*) → **Unrestricted** / **Allow background activity**. Enable **Auto-launch** if you see it.
2. *Settings → Battery → More settings → Optimise battery use* → Priyatham Health → **Don't optimise**.
3. **Recent apps** → hold (or swipe down on) the Priyatham Health card → **Lock**.

Other brands: see [dontkillmyapp.com](https://dontkillmyapp.com) for your phone model.

## 5. Updating to a new version

Download the newer APK and install it **over** the existing app. Your data, meal plans and laptops stay.

> Updates only install if the APK is signed with the **same key** as the version you have. Official releases on this repo always are. If you build your own copy, see [BUILD-FROM-SOURCE.md](BUILD-FROM-SOURCE.md#signing).

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| *"App not installed"* | An app with the same name but a different signature exists: uninstall it first. Or free up storage. |
| Alarms late or silent | Section 4. In the app: *Settings → Phone permissions*, all rows ✓. Use **Test alarm**. |
| Only a notification, no full-screen alarm | *Settings → Apps → Priyatham Health → Notifications →* allow **full-screen notifications**. |
| Steps show 0 | Allow **Physical activity**. Steps are counted from the first time the app reads the sensor. |
| Ride stuck on *"Finding GPS…"* | Go outdoors, turn Location on with precise location, wait 10–30 s. |
| Phone screen time empty | *Settings → Apps → Special app access → Usage access →* Priyatham Health **On**. |
| Fonts look plain | Open the app once while online. The fonts are cached after that. |

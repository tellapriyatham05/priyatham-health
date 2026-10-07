# JARVIS

Two apps: **JARVIS for Windows** (laptop, below) and **JARVIS for Android** (phone, further down).

## JARVIS for Windows

Say **"Jarvis"** (or "Hey Jarvis", click the character, or press **Ctrl+Alt+J**): your character flies across the
screen and lands in the corner, like a desktop companion. A small, clean card next to it shows what you said and the
reply. It stays there while you work; say **"Jarvis, hide"** and it flies away. Offline, no API keys.

- **Your own character:** Settings → Character → *Choose image…* (for example your Iron Man picture). The background
  is removed on your laptop and the figure is animated: fly-in, floating, glowing while it talks. Drag it anywhere.
- **Voice:** Windows' offline voices, preferring the Indian-English male voice (Microsoft Ravi) when installed.
- **Fast:** recording starts the moment you say "Jarvis", actions start while JARVIS is still speaking, and the slower
  Whisper double-check only runs when the quick recogniser wasn't understood.

**Download:** [JARVIS-Windows.zip](https://github.com/tellapriyatham05/priyatham-health/releases/tag/jarvis-windows-latest)
→ unzip → run `JARVIS.exe` (SmartScreen: More info → Run anyway). Details in `jarvis-windows/README-WINDOWS.txt`.

Commands: open apps/projects/folders/websites, close apps, coding/study/good-night routines, volume, brightness,
Wi-Fi and Bluetooth, media keys, YouTube and Google, timers, reminders, alarms, memory ("remember MediaAI is my main
project"), screen time and app limits, lock/sleep/shut down (asks first), screenshot, type text, read clipboard.

Built with Python (PySide6, openWakeWord + Vosk + Whisper offline speech, U²-Net background removal, Windows SAPI
voices) by `jarvis-windows/build_windows.ps1`; GitHub Actions builds, tests and publishes the zip on every push.

---

# JARVIS for Android

A personal voice assistant for Android that works offline. Say **"Hey Jarvis"** and a full-screen
JARVIS display appears: an animated holographic face, your notifications, RAM, storage, battery,
screen time and app limits. Give a command and JARVIS does it, then answers in a robotic voice.

No cloud, no AI service, no API keys. The wake word, speech and command handling run on the phone.

**[Download JARVIS.apk](jarvis-android/release/JARVIS.apk)** (phone version, v1.0)

## Install on your OnePlus

1. Copy `JARVIS.apk` to the phone and open it. Allow "Install unknown apps" for your file manager or browser when asked.
2. If Play Protect warns that the app was built for an older Android version, tap **More details → Install anyway**.
   JARVIS targets Android 9 on purpose so it can switch Wi-Fi and Bluetooth for you.
3. Open **JARVIS** and go through **Setup** from top to bottom. Each row has an **Allow** button.
4. **Notification access** and the **JARVIS helper** are "restricted settings" for apps installed from a file. If their
   switch is greyed out: Settings → Apps → JARVIS → ⋮ (top right) → **Allow restricted settings**, then try again.
5. On OnePlus, also set Settings → Apps → JARVIS → Battery → **Unrestricted**, so "Hey Jarvis" keeps working all day.
6. Tap **Offline speech recognition** once, on Wi-Fi, to download Google's offline English speech pack.
7. Tap **Start listening**, then say "Hey Jarvis".

Other ways to open JARVIS: the **Talk to JARVIS** icon, the **JARVIS** Quick Settings tile, or the "Talk" button
in the listening notification.

## What you can say

| Area | Examples |
| --- | --- |
| Calls | "call Priyatham", "call 98480 12345" |
| Messages | "message Priyatham that I'll reach in 10 minutes", "text Mom I'm on the way", "WhatsApp Priyatham I'll be late" |
| Follow-ups | "message Priyatham" → "What should I say?" → "tell him I'll come at 6" |
| Notifications | "read my notifications", "read my WhatsApp messages", "what did Priyatham say", "reply I'll call you later", "clear notifications" |
| Phone controls | "brightness 40 percent", "increase brightness", "Wi-Fi off", "Bluetooth on", "torch on", "volume up", "mute", "do not disturb on", "silent mode", "lock the phone", "take a screenshot" |
| Apps and web | "open Instagram", "open YouTube", "open wifi settings", "search for biryani near me", "play arijit songs on YouTube" |
| Music | "play music", "play Believer", "pause", "next song", "previous song" |
| Clock | "set an alarm for 6:30 am", "wake me up at 7", "set a timer for 5 minutes", "remind me tomorrow at 10 am to pay rent", "remind me in 20 minutes to call Mom" |
| Phone info | "what time is it", "what's the date", "battery", "how much RAM", "storage", "system status", "screen time", "how long have I used Instagram today" |
| Memory | "remember MediaAI is my main project", "remember my playlist is Workout Mix", "what do you remember", "forget my main project" |
| Routines | "good night", "good morning", "coding mode", "study mode", "gym mode", "driving mode" (edit them in the app) |
| Health | "log 500 ml water", "I drank a glass of water", "how much water today", "log my weight 72" |
| Voice | "speak faster", "speak slower", "switch to robot voice", "change your voice" |
| Conversation | "stop", "thank you", "who are you", "what can you do" |

Anything JARVIS doesn't understand is listed under **Recent commands** in the app, so new phrasings can be added later.

## Settings in the app

- **Voice style:** Classic JARVIS (robotic), Full robot, Calm, Professional. Plus voice picker, speaking speed, and what JARVIS calls you.
- **Reply style:** JARVIS ("..., sir"), Friendly, or Short.
- **Wake word sensitivity:** move left if JARVIS wakes by mistake, right if it misses you.
- **Routines:** one per line, `name: command; command; ...`
- **Daily app limits:** `app: minutes`. Shown on the HUD, with a notification when you pass one.
- **"Message ..." sends with:** WhatsApp (default) or SMS. "Text ..." and "SMS ..." always use SMS.

## Limits of this version

- The wake word is **"Hey Jarvis"**. The free offline model is trained on that phrase, not "Jarvis" alone.
- Commands follow fixed phrase patterns (see the table). Without an AI model, free-form questions are sent to a web search.
- Laptop control, cross-device commands and "what's on my screen" are not in this version.
- Mobile data, airplane mode, hotspot and location can only be switched by you on Android; JARVIS opens the right panel.
- WhatsApp sending is automatic only with the JARVIS helper (Accessibility) on; otherwise you tap Send.

## How it works

`jarvis-android/` is a plain Java Android app (no Gradle):

| File | Job |
| --- | --- |
| `JarvisService` | Foreground service; runs the wake-word detector on the microphone |
| `WakeWordEngine` | openWakeWord "hey jarvis" models on ONNX Runtime (mel spectrogram → embedding → classifier) |
| `HudActivity`, `FaceView` | Full-screen display, animated face with lip-synced mouth, panels |
| `CommandParser`, `Brain`, `Actions` | Phrase patterns → intent; context and memory; the actual phone actions |
| `Speaker` | Offline Android text-to-speech plus a ring-modulator/comb filter for the robotic voice |
| `NotifListener`, `JarvisAccessibility` | Notifications; WhatsApp Send button, lock, screenshot, Quick Settings fallback |

Build it with `jarvis-android/build.sh` (needs a JDK and `apt-get install aapt dalvik-exchange zipalign apksigner`).
The APK is signed with `jarvis-android/keystore/jarvis.keystore`, so new builds install over old ones.

## Credits and licences

- Wake-word models: [openWakeWord](https://github.com/dscripka/openWakeWord) by David Scripka. The pretrained models
  are licensed CC BY-NC-SA 4.0, so this app is for personal, non-commercial use.
- [ONNX Runtime](https://github.com/microsoft/onnxruntime), MIT licence.

The previous app in this repository, Priyatham Health v1.1, is still in the git history (commit `01a822e`).

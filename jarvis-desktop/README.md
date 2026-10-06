# JARVIS Desktop — Iron Man on your screen

Say **"Jarvis, open YouTube"**, **"Jarvis, volume 50"** or **"Jarvis, remind me in 20 minutes to call mom"**.
Iron Man flies in across your screen, does the job, and answers in a British JARVIS voice.

100 % offline: no account, no cloud, no AI chatbot. Your voice never leaves your PC.
Built on [Stuffy](https://github.com/tellapriyatham05/stuffy-voice-assistant): same listening engine and commands, with Iron Man in place of the hamster.

**[⬇️ Download JARVIS-Setup.exe](https://github.com/tellapriyatham05/priyatham-health/releases/tag/jarvis-desktop-latest)** · [📋 Voice commands](docs/VOICE_COMMANDS.md)

## Install
1. Download `JARVIS-Setup.exe` and double-click it. (Blue "Windows protected your PC" box? **More info → Run anyway**.)
2. Allow the microphone if Windows asks.
3. Say **"Jarvis, what time is it?"**

It replaces the older JARVIS (the zip version): that one is closed and removed from start-up automatically,
and the Iron Man picture you chose there is reused.

## What Iron Man does on screen
| When | He… |
|---|---|
| You say "Jarvis" | flies in across the screen (or boosts up and loops if he's already there) |
| Waiting | hovers in his corner, boot jets firing; every few minutes he patrols the screen, scans, or lands for a rest |
| Listening / thinking | sound waves, spinning HUD rings |
| Searching · opening an app · typing · music · Wi-Fi · timers | magnifier · flies out and throws a hologram window · holo keyboard · notes · signal · bell |
| Done / didn't understand / "restart?" | check mark · "?" · "Sure?" panel |
| "Jarvis, quit" / "bye" / "hide" | blasts off out of the screen (still listening; "Jarvis" brings him back) |

Right-click him (or the tray icon) for: **Iron Man on screen** (your own picture, size small/medium/large,
text bubble on/off), **Jarvis's voice** (George, Lewis, Daniel, Fable…), pause, my commands, log, quit.
Drag him to move his corner. **Ctrl + Alt + J** = same as saying "Jarvis".

## How it works
```
microphone (renderer/overlay.js)
  → engine.js            Silero VAD cuts speech into sentences; Whisper tiny.en reads each one;
                         Whisper small re-reads it when exact words matter (typing, search)
  → brain/assistant.js   "Jarvis" found in the sentence → command → (confirm / numbers / dictation / routines)
  → brain/parser.js      sentence → actions (plain rules, unit-tested, no AI)
  → system/executor.js   actions → Windows (apps, keys, clicks, volume, Wi-Fi, timers…)
  → voice.js             Kokoro offline voice ("George", British); mic ignored while he talks
  → renderer/ironman/    Iron Man: flight paths, jets, holograms (ironman.js / .css), picture cut-out
```
JARVIS always listens and turns every sentence into text, then acts only when it starts with "Jarvis",
so there is no separate wake-word mode to get stuck in.

## For developers
```bash
cd jarvis-desktop
npm install
npm test              # parser + timers
npm start             # needs the models in models/ (see .github/workflows/jarvis-desktop.yml)
npm run test:voice    # Windows: recorded voices through the real app
npm run dist          # dist/JARVIS-Setup.exe
```
The build on GitHub Actions downloads the models, runs the tests and publishes the installer.

Speech models belong to their authors: Whisper (MIT), Silero VAD (MIT), Kokoro (Apache-2.0).
Iron Man is a Marvel character; your own picture stays on your PC and is never uploaded.

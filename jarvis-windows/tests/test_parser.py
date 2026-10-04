"""Run: python -m tests.test_parser  (prints each case; fails on a wrong intent)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from jarvis.parser import parse, score

CASES = [
    ("Jarvis, open VS Code", "open"), ("open my MediaAI project", "open"), ("open Downloads", "open"),
    ("close Chrome", "close"), ("open YouTube", "open"), ("search Google for best laptops 2026", "search"),
    ("play Believer on YouTube", "youtube"), ("play lofi music", "play"), ("coding mode", "unknown"),
    ("volume up", "volume"), ("set volume to 40 percent", "volume"), ("mute", "volume"), ("increase brightness", "brightness"),
    ("brightness 70", "brightness"), ("turn off wifi", "toggle"), ("bluetooth on", "toggle"), ("lock my laptop", "power"),
    ("shut down the computer", "power"), ("restart", "power"), ("put the laptop to sleep", "power"), ("pause", "media"),
    ("next song", "media"), ("play music", "media"), ("what time is it", "time"), ("what's the date today", "date"),
    ("battery", "battery"), ("cpu usage", "cpu"), ("how much ram", "ram"), ("storage", "storage"), ("system status", "status"),
    ("screen time", "screen_time"), ("how long have I used YouTube today", "screen_time"), ("set a timer for 25 minutes", "timer"),
    ("remind me in 20 minutes to drink water", "reminder"), ("remind me tomorrow at 10 am to submit the report", "reminder"),
    ("set an alarm for 6:30 am", "alarm"), ("remember that MediaAI is my main project", "remember"),
    ("remember my main project is at D:\\Projects\\MediaAI", "remember"), ("what do you remember", "list_memory"),
    ("take a screenshot", "screenshot"), ("show desktop", "window"), ("type hello world", "type"), ("read my clipboard", "clipboard"),
    ("new tab", "keys"), ("call Priyatham", "phone_only"), ("what is the capital of france", "search"), ("thank you", "thanks"),
    ("stop", "stop"), ("yes", "yes"), ("Hey Jarvis", "empty"), ("open wifi settings", "open_settings"), ("switch to robot voice", "voice"),
    ("who are you", "who_are_you"), ("cancel all reminders", "cancel_reminders"), ("empty the recycle bin", "recycle_bin"),
]
bad = 0
for text, want in CASES:
    c = parse(text)
    ok = c.intent == want
    bad += not ok
    print(("ok  " if ok else "BAD ") + f"{text:48s} -> {c!r}")
assert score("priyatam", "Priyatham Reddy") > 0.85 and score("media ai", "MediaAI") > 0.9
print(f"{len(CASES) - bad}/{len(CASES)} passed")
sys.exit(1 if bad else 0)

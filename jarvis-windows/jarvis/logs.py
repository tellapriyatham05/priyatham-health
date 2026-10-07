"""A small diagnostic log at %APPDATA%\\JARVIS\\jarvis.log (what was heard, replies, errors)."""
import logging
import logging.handlers
import os

from .store import data_dir

log = logging.getLogger("jarvis")
if not log.handlers:
    log.setLevel(logging.INFO)
    try:
        h = logging.handlers.RotatingFileHandler(os.path.join(data_dir(), "jarvis.log"), maxBytes=1_000_000,
                                                 backupCount=2, encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(threadName)s: %(message)s"))
        log.addHandler(h)
    except OSError:
        pass

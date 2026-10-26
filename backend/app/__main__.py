import argparse
import sys

import uvicorn

from . import config

parser = argparse.ArgumentParser(description="Personal Music Archive server")
parser.add_argument("--host", default="127.0.0.1",
                    help="use 0.0.0.0 to reach it from a phone on the same Wi-Fi (no login — trusted networks only)")
parser.add_argument("--port", type=int, default=8000)
parser.add_argument("--reload", action="store_true")
args = parser.parse_args()

# Started via pythonw (autostart, no console): stdout/stderr are None and uvicorn's
# logging would crash, so send everything to a log file instead.
if sys.stdout is None or sys.stderr is None:
    log_dir = config.ARCHIVE_ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "server.log"
    if log_path.exists() and log_path.stat().st_size > 5 * 1024 * 1024:
        log_path.replace(log_dir / "server.old.log")
    sys.stdout = sys.stderr = open(log_path, "a", encoding="utf-8", buffering=1)

uvicorn.run("app.main:app", host=args.host, port=args.port, reload=args.reload, use_colors=False)

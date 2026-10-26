"""Open Music Archive as a desktop app window, starting the server first if needed.

The desktop shortcut runs this with pythonw.exe, so no console window appears.
"""
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

URL = "http://localhost:8000/"
BACKEND = Path(__file__).resolve().parents[1] / "backend"


def server_up() -> bool:
    try:
        urllib.request.urlopen(URL + "api/health", timeout=1)
        return True
    except OSError:
        return False


def start_server() -> None:
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    exe = str(pythonw if pythonw.exists() else sys.executable)
    flags = 0
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    subprocess.Popen([exe, "-m", "app"], cwd=BACKEND, creationflags=flags, close_fds=True)
    for _ in range(60):
        if server_up():
            return
        time.sleep(0.25)


def find_browser() -> str | None:
    candidates = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    found = next((c for c in candidates if os.path.isfile(c)), None)
    return found or shutil.which("msedge") or shutil.which("chrome")


def main() -> None:
    if not server_up():
        start_server()
    browser = find_browser()
    if browser:
        # --app opens a standalone window without tabs or address bar
        subprocess.Popen([browser, f"--app={URL}"], close_fds=True)
    else:
        webbrowser.open(URL)


if __name__ == "__main__":
    main()

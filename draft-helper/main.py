"""
Entry point for the packaged Tassure Draft Helper. Runs the Flask API
(app.py) in a background thread and shows a system tray icon so staff know
the helper is running and have a way to quit it. Installed to start
automatically at Windows login (see installer.iss) — this is what makes
"install once, then it just works" true.
"""
import ctypes
import os
import socket
import sys
import threading
import winreg

import pystray
from PIL import Image, ImageDraw

from app import PORT, app as flask_app, start_outlook_event_listener, start_sent_items_reconciler

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE_NAME = "TassureDraftHelper"


def _register_for_startup():
    # No installer — the exe registers itself into the per-user Run key so
    # "download once, run once" is enough to make it start automatically at
    # every future Windows login. Idempotent: only writes if missing/stale,
    # and silently no-ops if not running as a frozen exe (e.g. `python
    # main.py` during development) since there's nothing durable to point at.
    if not getattr(sys, "frozen", False):
        return
    exe_path = f'"{sys.executable}"'
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
            try:
                current, _ = winreg.QueryValueEx(key, RUN_VALUE_NAME)
            except FileNotFoundError:
                current = None
            if current != exe_path:
                winreg.SetValueEx(key, RUN_VALUE_NAME, 0, winreg.REG_SZ, exe_path)
    except OSError:
        pass  # Registry access shouldn't ever block the tray icon from starting.


def _already_running() -> bool:
    # Windows Startup can launch this again on a second login/RDP session
    # while a prior instance is still alive — detect that and exit quietly
    # instead of crashing on "address already in use".
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def _run_flask():
    flask_app.run(host="127.0.0.1", port=PORT, threaded=True, use_reloader=False)


def _make_icon_image() -> Image.Image:
    # Small self-contained icon (a navy square with a white "T") so the
    # build doesn't depend on a bundled image asset.
    size = 64
    img = Image.new("RGBA", (size, size), (29, 58, 92, 255))  # #1d3a5c
    draw = ImageDraw.Draw(img)
    draw.rectangle([14, 14, 50, 22], fill="white")
    draw.rectangle([28, 14, 36, 50], fill="white")
    return img


def _quit(icon, _item):
    icon.stop()
    os._exit(0)


def main():
    if _already_running():
        # Bare `sys.exit(0)` here was completely silent — a staff member
        # re-downloading (e.g. to pick up an update) or double-clicking a
        # second time sees literally nothing happen, since the already-
        # running copy's tray icon is easy to miss (Windows hides tray
        # icons behind the "^" overflow arrow by default). Vincent, 2026-
        # 08-18: a user reported exactly this — multiple re-downloads,
        # click, "no response" every time. A native MessageBoxW needs no
        # extra dependency and matches this tool's already-minimal style.
        ctypes.windll.user32.MessageBoxW(
            0,
            "Tassure Draft Helper is already running.\n\n"
            "Look for its icon in the system tray (bottom-right, near the clock — "
            "click the ^ arrow to show hidden icons if you don't see it).\n\n"
            "It starts automatically every time you log in, so you only ever "
            "need to run this once.",
            "Tassure Draft Helper",
            0x40,  # MB_ICONINFORMATION
        )
        sys.exit(0)

    _register_for_startup()
    threading.Thread(target=_run_flask, daemon=True).start()
    start_outlook_event_listener()
    start_sent_items_reconciler()

    icon = pystray.Icon(
        "tassure-draft-helper",
        _make_icon_image(),
        "Tassure Draft Helper — Running",
        menu=pystray.Menu(pystray.MenuItem("Quit", _quit)),
    )
    icon.run()


if __name__ == "__main__":
    main()

# Building Tassure Draft Helper

Windows only (uses Outlook COM automation via `pywin32`).

This folder is the version-controlled copy of the source (previously it
only lived in a local, un-tracked folder on one machine). The actual
day-to-day working copy is `C:\Users\vincent\tassure-draft-helper\` —
after making changes there and confirming they work, copy the changed
files back into this folder and commit, so this copy never silently
drifts out of sync with what's actually shipping.

## One-time setup

```powershell
python -m pip install -r requirements.txt
```

## Build

```powershell
.\build.ps1
```

Produces `dist\TassureDraftHelper.exe` — a single onefile executable. There
is no separate installer: the exe registers itself into the per-user
Windows Startup key (`HKCU\...\Run`) the first time it runs (see
`main.py::_register_for_startup`), so "download the exe, run it once" is the
entire install step — no admin rights needed.

## Ship it

Copy `dist\TassureDraftHelper.exe` into
`tassure-invoice\public\downloads\TassureDraftHelper.exe` and commit — it
deploys with the site, versioned in git like everything else.

## What it does at runtime

- First run: registers itself to start at every future Windows login, then
  shows a small tray icon ("Tassure Draft Helper — Running") with a Quit
  option. If a second copy is launched while one is already running (e.g. a
  second login session or a re-download), it detects the port is taken and
  shows a message box pointing at the tray icon instead of silently exiting.
- Serves `http://127.0.0.1:51820` — `GET /health` and `POST /drafts/open` —
  bound to localhost only, CORS-restricted to the known app origins.
- `/drafts/open` creates real Outlook draft windows via COM automation
  (`.Display()` only, never `.Send()`) with any provided invoice PDF
  attachments already added.

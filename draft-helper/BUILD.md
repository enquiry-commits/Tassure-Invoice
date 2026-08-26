# Building Tassure Draft Helper

Windows only (uses Outlook COM automation via `pywin32`).

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
deploys with the site, versioned in git like everything else. Also copy
this whole source folder over `tassure-invoice\draft-helper\` and commit
there too (see that folder's own note at the top of its BUILD.md).

## outlook_gen_py_cache/ — historical, currently unused

This existed for `DispatchWithEvents`, which hooked Outlook's `ItemSend`
COM event as part of the auto-detected "sent" mechanism removed 2026-08-26
(see `app.py`'s module docstring and `_send_one_draft`'s own docstring for
why detection was replaced by a synchronous `.Send()` call from the web
app's own review screen instead). Nothing left in `app.py` calls
`DispatchWithEvents` — every `Outlook.Application` dispatch is the plain,
late-bound `win32com.client.Dispatch`, which never needed a pre-generated
typelib cache in the first place.

Left in place rather than torn out: harmless if inert, and removing it
means also touching `TassureDraftHelper.spec`/`build.ps1`'s `--add-data`
wiring and the `win32com.__gen_path__` rerouting at the top of `app.py` —
a cleanup that isn't blocking anything. Safe to delete in a future pass if
the smaller exe size is worth the surface area.

## What it does at runtime

- First run: registers itself to start at every future Windows login, then
  shows a small tray icon ("Tassure Draft Helper — Running") with a Quit
  option. If a second copy is launched while one is already running (e.g. a
  second login session or a re-download), it shows a message box pointing
  at the tray icon instead of silently exiting.
- Serves `http://127.0.0.1:51820` — bound to localhost only,
  CORS-restricted to the known app origins.
- `GET /health` — reports version and whether Outlook automation is
  currently routing to Classic Outlook.
- `POST /drafts/open` — creates real Outlook draft windows via COM
  automation, `.Display()` only, with any provided invoice PDF attachments
  already added. For a human to review and send manually in Outlook itself.
- `POST /drafts/send` — same MailItem construction, but `.Save()` then
  `.Send()` directly. Used by the web app's own Outlook-style review
  screen: the human already reviewed and clicked Send there, and the
  synchronous HTTP response (success, or a thrown COM error) is the web
  app's only source of truth for whether the email actually went out — no
  separate detection step, nothing to miss.

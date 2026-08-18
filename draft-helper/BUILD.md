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

## outlook_gen_py_cache/ — why this exists

Send-detection (`start_outlook_event_listener` in `app.py`) hooks Outlook's
`ItemSend` COM event, which needs a generated Python wrapper for Outlook's
type library. Generating that wrapper on the fly works fine in a normal
`python app.py` run, but fails inside the frozen exe — PyInstaller's import
system can't pick up a module written to disk mid-run the way a normal
Python process can (reproduced directly: `ModuleNotFoundError` right after
what looked like a successful generate). The fix is the standard one for
this pywin32 + PyInstaller combination: generate the wrapper once, commit
it, and ship it as bundled data (`--add-data
"outlook_gen_py_cache;outlook_gen_py_cache"`, already in `build.ps1`) so the
frozen exe only ever *reads* an already-existing module.

This only covers whatever Outlook typelib version was installed when it was
generated. A real version mismatch on a staff machine doesn't break
anything — it just means that one machine's copy quietly skips send-
detection (COM event registration failure is caught silently); opening
drafts in Outlook, the core feature, never depends on this at all.

**Regenerating it** (only needed if Outlook's typelib version changes
enough that registration starts failing more broadly — check via the
`isClassicOutlook`/`outlookPath` fields already in `/health`, or just by
testing send-detection directly):

```powershell
python -c "import win32com.client.gencache as g; g.EnsureDispatch('Outlook.Application')"
```

Then copy the generated `<CLSID>x0x9x6` folder, `dicts.dat` and
`__init__.py` from `%TEMP%\gen_py\<python version>\` over
`outlook_gen_py_cache\` (minus any `__pycache__` folders), replacing what's
there, and rebuild.

## What it does at runtime

- First run: registers itself to start at every future Windows login, then
  shows a small tray icon ("Tassure Draft Helper — Running") with a Quit
  option. If a second copy is launched while one is already running (e.g. a
  second login session or a re-download), it shows a message box pointing
  at the tray icon instead of silently exiting.
- Serves `http://127.0.0.1:51820` — `GET /health` and `POST /drafts/open` —
  bound to localhost only, CORS-restricted to the known app origins.
- `/drafts/open` creates real Outlook draft windows via COM automation
  (`.Display()` only, never `.Send()`) with any provided invoice PDF
  attachments already added, tagged with a hidden property carrying the
  draft's own database id.
- A separate long-lived background thread listens for Outlook's `ItemSend`
  event. When a tagged item is actually sent, it reports back to
  `POST /api/client-communications/drafts/mark-sent` (authenticated via the
  `DRAFT_HELPER_SECRET` bearer token baked into `app.py`, matching the env
  var of the same name in Vercel) so the draft's status flips to `sent`
  automatically — no more relying on a human to click "Mark as Sent" in
  Delivery History, though that manual fallback still exists and still
  works for anything this can't see (missed reports, drafts opened before
  this feature existed, a version mismatch on that one machine, etc).

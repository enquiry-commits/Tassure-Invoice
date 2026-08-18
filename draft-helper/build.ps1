# Builds TassureDraftHelper.exe (onefile, no console window) into .\dist\.
# No separate installer — the exe self-registers into the Windows Startup
# registry key the first time it's run (see main.py::_register_for_startup),
# so "download the exe, run it once" is the entire install step.
$ErrorActionPreference = "Stop"

python -m PyInstaller --onefile --noconsole --name TassureDraftHelper `
  --hidden-import=win32timezone `
  --add-data "assets;assets" `
  --add-data "outlook_gen_py_cache;outlook_gen_py_cache" `
  main.py

Write-Host "Built: dist\TassureDraftHelper.exe"

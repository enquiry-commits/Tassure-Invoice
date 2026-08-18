"""
Tassure Draft Helper — local HTTP service that lets the Client Communications
page in the tassure-invoice web app open real Outlook compose windows (with
invoice PDFs already attached) via COM automation. Only `.Display()` is ever
called — never `.Send()` — so a human still reviews and sends every email
manually, matching the legacy BULK.xlsm macro's behaviour.

Bound to 127.0.0.1 only; never reachable from the network.
"""
import base64
import html
import os
import shutil
import sys
import tempfile
import threading
import time
import winreg

import pythoncom
import requests
import win32com
import win32com.client
from flask import Flask, jsonify, request
from flask_cors import CORS

# DispatchWithEvents (used below to catch Outlook's ItemSend) needs a
# generated wrapper module for Outlook's COM type library. Generating one
# fresh at runtime works fine unpackaged, but fails inside a frozen
# PyInstaller onefile build — its import system can't pick up a module
# written to disk mid-run the way a normal Python process can (confirmed by
# reproducing it: ModuleNotFoundError right after a successful-looking
# generate). The fix, and the standard one for this exact pywin32+PyInstaller
# combination: pre-generate it once at build time (see BUILD.md) and ship it
# as bundled data — outlook_gen_py_cache/, alongside assets/ — so the frozen
# exe only ever *reads* an already-existing module, never generates one.
# Only covers whatever Outlook typelib version was installed at build time;
# a real mismatch on a staff machine just means this one feature quietly
# doesn't activate (see start_outlook_event_listener) — Display() itself
# never depends on any of this.
# Same base-path resolution as _asset_path below (defined inline since this
# needs to run before DispatchWithEvents is ever called, well above that
# function's own definition).
#
# Setting win32com.__gen_path__ alone is not enough: `import win32com`
# already materialized `sys.modules["win32com.gen_py"].__path__` from
# win32com's OWN default before this line ever runs (see win32com/__init__.py
# — it computes __gen_path__ and freezes it into gen_py.__path__ as part of
# package init), so a later reassignment of the win32com.__gen_path__
# attribute doesn't retroactively change where imports actually search.
# gen_py.__path__ itself has to be replaced directly.
_BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
win32com.__gen_path__ = os.path.join(_BASE_DIR, "outlook_gen_py_cache")
sys.modules["win32com.gen_py"].__path__ = [win32com.__gen_path__]

PORT = 51820
VERSION = "1.5.2"

WEB_APP_URL = "https://tassure-corporate-services.vercel.app"
# Matches the DRAFT_HELPER_SECRET env var proxy.ts checks for on this one
# route — the web app requires a Tassure login session on every other
# route, which this background COM event thread has no way to carry.
# Shared across every staff install (baked into the exe, not per-user); a
# leaked copy can only mark drafts as sent, nothing more sensitive.
DRAFT_HELPER_SECRET = "q7X9NyxHSIux_m7p3V7Jtvg4x-oimxzFKv6c2wp24iM"

# Every AR template's body ends with this line ("PAYMENT METHOD付款方式:"),
# right where the original Word templates had the payment-options graphic
# (cheque/bank transfer/PayNow QR, all in one static company-wide image —
# same for every client, never merged per-company) pasted in below it.
# Templates themselves stay plain text in the database/editing UI; only the
# Helper — the one place that actually builds the Outlook item — upgrades
# to an HTML body and embeds this bundled image, exactly where the marker
# appears, so nothing else about the merge/editing pipeline has to change.
PAYMENT_MARKER = "PAYMENT METHOD"
PAYMENT_IMAGE_CID = "tassure-payment-options"

# Attached to every draft, every send — company-wide, never per-client, so
# it's bundled here rather than sent over the wire by the web app each time.
STANDING_ATTACHMENTS = ["Bank Details 2026 - Tassure Group.pdf"]

ALLOWED_ORIGINS = [
    "https://tassure-corporate-services.vercel.app",
    "https://tassure-invoice.vercel.app",
    "http://localhost:3000",
]

app = Flask(__name__)
CORS(app, origins=ALLOWED_ORIGINS)

# Outlook COM automation isn't thread-safe across simultaneous calls (each
# MailItem must be built to completion before the next starts), and the
# Flask dev server handles requests on separate threads — serialize with a
# lock rather than letting two /drafts/open requests race each other.
_outlook_lock = threading.Lock()

# Custom MAPI property used to tag every MailItem we create with the web
# app's own draft id, so the ItemSend listener below can report back which
# draft was actually sent — Outlook's ItemSend event carries no such link on
# its own, and Display() only opens a window with no further callback.
# GUID is arbitrary but must stay fixed once shipped, since an in-flight
# draft opened by an older Helper version still needs to match after an
# update. PT_UNICODE (0x001F): stored as a plain string.
DRAFT_ID_PROP = (
    "http://schemas.microsoft.com/mapi/string/"
    "{5C43E92B-15C3-4EA1-A019-0432EEA178AD}/TassureDraftId/0x001F"
)


def _report_sent(draft_id, sender_email):
    # Best-effort, fire-and-forget: a missed report (network blip, laptop
    # asleep, etc.) just leaves the draft for a human to click "Mark as
    # Sent" in Delivery History, exactly like before this feature existed —
    # never something worth surfacing to the user or retrying aggressively.
    try:
        requests.post(
            f"{WEB_APP_URL}/api/client-communications/drafts/mark-sent",
            json={"id": int(draft_id), "senderEmail": sender_email},
            headers={"Authorization": f"Bearer {DRAFT_HELPER_SECRET}"},
            timeout=10,
        )
    except Exception:  # noqa: BLE001
        pass


class _OutlookEvents:
    """
    Event sink for Outlook.Application, bound in a dedicated long-lived
    background thread (see start_outlook_event_listener) rather than the
    short-lived Application object /drafts/open creates per-request — staff
    often sit on a draft for hours before actually sending it, well after
    that request has finished. Both COM objects drive the same one running
    Outlook.exe, so events fire regardless of which object created the item.
    """

    def OnItemSend(self, item, cancel):
        try:
            draft_id = item.PropertyAccessor.GetProperty(DRAFT_ID_PROP)
        except Exception:  # noqa: BLE001 - not one of ours, or property unset
            draft_id = None
        if draft_id:
            try:
                sender_email = item.SendUsingAccount.SmtpAddress
            except Exception:  # noqa: BLE001
                sender_email = None
            threading.Thread(
                target=_report_sent, args=(draft_id, sender_email), daemon=True,
            ).start()
        return cancel  # never intercept the send — purely observing


_event_listener_started = False


def start_outlook_event_listener():
    """
    Best-effort: if COM event registration fails for any reason (Outlook not
    installed yet, a locked-down environment, missing typelib cache), the
    Helper's core open-draft feature must keep working regardless — auto-
    detected "sent" status simply won't fire this session, and the manual
    "Mark as Sent" fallback in Delivery History still covers it.
    """
    global _event_listener_started
    if _event_listener_started:
        return
    _event_listener_started = True

    def _run():
        try:
            pythoncom.CoInitialize()
            # Must stay referenced for the life of this thread — the event
            # connection is tied to this object; letting it get garbage
            # collected would silently stop delivering ItemSend.
            outlook = win32com.client.DispatchWithEvents("Outlook.Application", _OutlookEvents)
            while True:
                pythoncom.PumpWaitingMessages()
                time.sleep(0.2)
        except Exception:  # noqa: BLE001
            pass

    threading.Thread(target=_run, daemon=True, name="outlook-event-listener").start()


def _resolve_outlook_exe_path() -> str | None:
    """
    Ask Windows itself which .exe actually serves the "Outlook.Application"
    COM ProgID — the same lookup win32com.client.Dispatch performs
    internally. Reading it ourselves lets us tell staff exactly what's
    wrong (and where) instead of silently opening whatever Windows resolves
    when Classic and "new" Outlook are both installed side by side.
    """
    try:
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r"Outlook.Application\CLSID") as key:
            clsid = winreg.QueryValueEx(key, "")[0]
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, rf"CLSID\{clsid}\LocalServer32") as key:
            server = winreg.QueryValueEx(key, "")[0]
        return server.strip('"')
    except OSError:
        return None


def _is_classic_outlook_path(path: str | None) -> bool:
    # Classic (desktop) Outlook always ends in OUTLOOK.EXE under a normal
    # Program Files install. New Outlook for Windows is a separate MSIX/UWP
    # app (a different exe entirely, under WindowsApps) and has never
    # registered this COM ProgID as of this writing — but check defensively
    # rather than assume, since Microsoft's rollout has changed before.
    if not path:
        return False
    lowered = path.lower()
    return lowered.endswith("outlook.exe") and "windowsapps" not in lowered


def _assign_sender(outlook, mail, sender_email: str):
    """Assign the exact Outlook account selected in the web workbench."""
    requested = (sender_email or "").strip().lower()
    if not requested:
        return

    for account in outlook.Session.Accounts:
        smtp_address = str(getattr(account, "SmtpAddress", "") or "").strip().lower()
        display_name = str(getattr(account, "DisplayName", "") or "").strip().lower()
        if requested not in (smtp_address, display_name):
            continue

        # SendUsingAccount is not exposed as a normal writable attribute in
        # every Outlook/pywin32 combination. DISPID 64209 is Outlook's
        # documented MailItem.SendUsingAccount property.
        try:
            mail.SendUsingAccount = account
        except Exception:  # noqa: BLE001 - fall back to the COM property id
            mail._oleobj_.Invoke(*(64209, 0, 8, 0, account))
        return

    raise RuntimeError(
        f'Outlook account "{sender_email}" is not configured on this computer.'
    )


def _asset_path(name: str) -> str:
    return os.path.join(_BASE_DIR, "assets", name)


def _plain_text_to_html(text: str) -> str:
    return html.escape(text).replace("\r\n", "\n").replace("\n", "<br>\n")


def _set_body(mail, body_text: str):
    """
    Plain body normally — Outlook's own .Body already renders that with no
    surprises. Only upgrades to an HTML body (to embed the payment-options
    image) when the text actually reaches the PAYMENT_MARKER line, so a
    template with no payment section (e.g. a document-reminder letter)
    behaves exactly as before.
    """
    body_text = body_text or ""
    if PAYMENT_MARKER not in body_text.upper():
        mail.Body = body_text
        return

    html_body = _plain_text_to_html(body_text)
    image_path = _asset_path("payment_options.png")
    if os.path.isfile(image_path):
        attachment = mail.Attachments.Add(image_path)
        # PR_ATTACH_CONTENT_ID (MAPI) — marks this attachment as the inline
        # image the cid: reference below points to, which is also what
        # keeps Outlook from showing it as a regular visible attachment.
        attachment.PropertyAccessor.SetProperty(
            "http://schemas.microsoft.com/mapi/proptag/0x3712001E", PAYMENT_IMAGE_CID,
        )
        # The source file is shipped at 4x its display size (Vincent,
        # 2026-08-18: the old file's QR code didn't actually scan at all —
        # confirmed with two separate decoders — so it was rebuilt from the
        # official Bank Details PDF at real resolution). Constraining the
        # display width keeps the email's layout the same as before while
        # giving the QR real pixels to work with once Outlook downscales it.
        html_body += f'<br><img src="cid:{PAYMENT_IMAGE_CID}" width="700">'
    mail.HTMLBody = html_body


def _open_one_draft(outlook, draft: dict) -> dict:
    tmp_dir = tempfile.mkdtemp(prefix="tassure-draft-")
    try:
        mail = outlook.CreateItem(0)  # olMailItem
        _assign_sender(outlook, mail, draft.get("senderEmail") or "")
        mail.To = draft.get("to") or ""
        mail.CC = draft.get("cc") or ""
        mail.Subject = draft.get("subject") or ""
        _set_body(mail, draft.get("body"))

        draft_id = draft.get("id")
        if draft_id:
            mail.PropertyAccessor.SetProperty(DRAFT_ID_PROP, str(draft_id))

        for att in draft.get("attachments") or []:
            file_name = att.get("fileName") or "attachment.pdf"
            # Attachment filenames come from company/invoice data — strip
            # path separators so a crafted name can't write outside tmp_dir.
            safe_name = os.path.basename(file_name).replace("\\", "_").replace("/", "_")
            file_path = os.path.join(tmp_dir, safe_name)
            with open(file_path, "wb") as f:
                f.write(base64.b64decode(att["base64"]))
            mail.Attachments.Add(file_path)

        for name in STANDING_ATTACHMENTS:
            path = _asset_path(name)
            if os.path.isfile(path):
                mail.Attachments.Add(path)

        mail.Display()
        return {"ok": True}
    except Exception as e:  # noqa: BLE001 - report per-draft, never crash the batch
        return {"ok": False, "error": str(e)}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@app.get("/health")
def health():
    outlook_path = _resolve_outlook_exe_path()
    return jsonify({
        "ok": True,
        "version": VERSION,
        "outlookPath": outlook_path,
        "isClassicOutlook": _is_classic_outlook_path(outlook_path),
    })


@app.post("/drafts/open")
def open_drafts():
    payload = request.get_json(silent=True) or {}
    drafts = payload.get("drafts")
    if not isinstance(drafts, list) or not drafts:
        return jsonify({"error": "drafts must be a non-empty array"}), 400

    outlook_path = _resolve_outlook_exe_path()
    if not _is_classic_outlook_path(outlook_path):
        return jsonify({
            "error": (
                "Windows is not currently routing Outlook automation to Classic "
                "Outlook (resolved: " + (outlook_path or "not found") + "). "
                'In Outlook, turn OFF "Try the new Outlook" (top-right toggle), '
                "then try again."
            )
        }), 409

    results = []
    pythoncom.CoInitialize()
    try:
        with _outlook_lock:
            outlook = win32com.client.Dispatch("Outlook.Application")
            for draft in drafts:
                results.append(_open_one_draft(outlook, draft))
    finally:
        pythoncom.CoUninitialize()

    return jsonify({"results": results})


if __name__ == "__main__":
    start_outlook_event_listener()
    app.run(host="127.0.0.1", port=PORT, threaded=True)

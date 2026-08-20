"""
Tassure Draft Helper — local HTTP service that lets the Client Communications
page in the tassure-invoice web app open real Outlook compose windows (with
invoice PDFs already attached) via COM automation. Only `.Display()` is ever
called — never `.Send()` — so a human still reviews and sends every email
manually, matching the legacy BULK.xlsm macro's behaviour.

Bound to 127.0.0.1 only; never reachable from the network.
"""
import base64
import datetime
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
VERSION = "1.6.0"

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

# Standard MAPI proptags (not Tassure-specific, unlike DRAFT_ID_PROP above) —
# set directly in _assign_sender so the sender identity is written as a
# plain SMTP-type entity, bypassing Outlook's automatic GAL/Exchange
# resolution (see that function's own docstring for why that resolution
# breaks sending for a same-org Microsoft 365 account).
_PR_SENT_REPRESENTING_NAME = "http://schemas.microsoft.com/mapi/proptag/0x0042001F"
_PR_SENT_REPRESENTING_ADDRTYPE = "http://schemas.microsoft.com/mapi/proptag/0x0064001F"
_PR_SENT_REPRESENTING_EMAIL_ADDRESS = "http://schemas.microsoft.com/mapi/proptag/0x0065001F"


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


# olFolderSentMail — Outlook's own constant, not worth pulling in the full
# win32com MAPI constants module for just this one value.
_OL_FOLDER_SENT_MAIL = 5
RECONCILE_INTERVAL_SECONDS = 300
RECONCILE_LOOKBACK_DAYS = 3


def _reconcile_sent_items(outlook):
    """
    Safety net for OnItemSend above: live COM event delivery is best-effort
    (see that function's own docstring) and can occasionally miss a real
    send with no visible sign to the user — Vincent, 2026-08-19, confirmed
    a real miss with the computer and Helper both running the whole time,
    so this isn't only the already-known "listener wasn't running" case.
    Re-scans Sent Items on a fixed interval for anything carrying our
    DRAFT_ID_PROP and reports it. /mark-sent is idempotent (a draft already
    'sent'/'skipped' is left untouched), so re-reporting one OnItemSend
    already caught is harmless — this never needs to know what the live
    listener did or didn't see.

    Scans EVERY configured account's own Sent Items folder, not just
    GetNamespace("MAPI").GetDefaultFolder() — that call only ever returns
    the PRIMARY account's folder. Vincent, 2026-08-19: staff send AR drafts
    from finance@tassure.com, which is a secondary account on a profile
    whose primary is contact@tassure.com — this system's whole reason for
    existing (a secondary sending account) is exactly the case the old
    single-folder scan could never see. Deduplicates by StoreID first
    since single-account setups (or any account sharing a store with the
    primary) would otherwise have their Sent Items scanned twice per cycle
    for no benefit.

    Vincent, 2026-08-20: a real staff report (still yellow, immediate send,
    latest Helper version, real PDF attached — so neither the listener nor
    the account/folder scan itself was the gap) traced back to the old
    version of this function, which filtered with
    Items.Restrict(f"[SentOn] >= '{cutoff:%m/%d/%Y %I:%M %p}'"). Restrict's
    date literal is parsed against the CURRENT USER'S Windows short-date
    format, not a fixed one — confirmed live on a Singapore-locale machine
    (d/M/yyyy, day-first), which silently misreads a US-style m/d/Y string
    whenever the cutoff's day-of-month is ambiguous with the month (≤12),
    and produces an outright invalid date (silently caught, folder skipped
    for that whole cycle) whenever it isn't. Every Tassure staff machine is
    Singapore-locale, so this wasn't an edge case. Sorting and breaking on a
    real comparable datetime sidesteps Restrict's date-string parsing
    entirely — no locale dependency left to break on a different machine.
    """
    try:
        seen_store_ids = set()
        folders = []
        for account in outlook.Session.Accounts:
            try:
                folder = account.DeliveryStore.GetDefaultFolder(_OL_FOLDER_SENT_MAIL)
            except Exception:  # noqa: BLE001 - this one account's store unavailable
                continue
            if folder.StoreID in seen_store_ids:
                continue
            seen_store_ids.add(folder.StoreID)
            folders.append(folder)

        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
            days=RECONCILE_LOOKBACK_DAYS,
        )
        for sent_folder in folders:
            try:
                items = sent_folder.Items
                items.Sort("[SentOn]", True)  # newest first
            except Exception:  # noqa: BLE001 - this one folder failed, try the rest
                continue
            for item in items:
                try:
                    sent_on = item.SentOn
                except Exception:  # noqa: BLE001 - not a mail item / no SentOn
                    continue
                if sent_on < cutoff:
                    break  # sorted newest-first — nothing further is in range
                try:
                    draft_id = item.PropertyAccessor.GetProperty(DRAFT_ID_PROP)
                except Exception:  # noqa: BLE001 - not one of ours, or property unset
                    continue
                if not draft_id:
                    continue
                try:
                    sender_email = item.SendUsingAccount.SmtpAddress
                except Exception:  # noqa: BLE001
                    sender_email = None
                _report_sent(draft_id, sender_email)
    except Exception:  # noqa: BLE001 - best-effort, the next cycle tries again
        pass


_reconciler_started = False


def start_sent_items_reconciler():
    """
    Independent of the live OnItemSend listener above — its own thread, own
    Outlook.Application dispatch (same one-apartment-per-thread pattern
    that listener already uses), own fixed polling interval. If COM access
    fails here for any reason, the loop below just tries again next cycle;
    the Helper's core features are unaffected either way.
    """
    global _reconciler_started
    if _reconciler_started:
        return
    _reconciler_started = True

    def _run():
        try:
            pythoncom.CoInitialize()
            outlook = win32com.client.Dispatch("Outlook.Application")
        except Exception:  # noqa: BLE001
            return
        while True:
            time.sleep(RECONCILE_INTERVAL_SECONDS)
            _reconcile_sent_items(outlook)

    threading.Thread(target=_run, daemon=True, name="sent-items-reconciler").start()


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
    """
    Assign the exact Outlook account selected in the web workbench.

    Vincent, 2026-08-19: staff-observed proof (screenshot of the compose
    window's From dropdown) that the account requested here wasn't what
    actually showed — it always fell back to the profile's primary account.
    Per Microsoft's own docs ("Create a Sendable Item for a Specific
    Account Based on the Current Folder"): for a MailItem specifically,
    SendUsingAccount alone is documented as the AppointmentItem pattern —
    a MailItem needs its Sender property set to the account's own
    AddressEntry, "otherwise the MailItem is created for the primary
    account" (word for word what was observed).

    Vincent, 2026-08-20: REMOVED the Sender assignment above — confirmed
    live (real Outlook, real send attempt) that it breaks sending outright
    on an Exchange/Microsoft 365-backed account ("Something went wrong",
    the compose window's From field showing a raw LegacyExchangeDN string
    instead of an address). account.CurrentUser.AddressEntry.Type is "EX"
    for this kind of account — every business/M365 mailbox, i.e. exactly
    the accounts this tool is used with — and assigning an EX-type
    AddressEntry to .Sender embeds that unresolvable DN into the message.
    Tried the documented alternative (Session.CreateRecipient(smtp)
    .Resolve().AddressEntry) too — same EX type, same broken DN: any
    lookup path that lets Outlook resolve the address against its own
    directory (the GAL) lands on the same broken EX identity, because
    finance@/contact@/every other Tassure account lives in the same
    Microsoft 365 org.

    Fixed for real by setting the PR_SENT_REPRESENTING_* MAPI properties
    directly as an explicit SMTP-type identity, bypassing GAL resolution
    entirely — confirmed live: From displays the plain address (no DN),
    and it does not break sending. Both this and SendUsingAccount are
    still needed: this affects only how the message identifies its
    sender (the visible From, and this SMTP-type write happens to be
    exactly what unblocked it), SendUsingAccount is what actually
    controls which account transmits the message.
    """
    requested = (sender_email or "").strip().lower()
    if not requested:
        return

    for account in outlook.Session.Accounts:
        smtp_address = str(getattr(account, "SmtpAddress", "") or "").strip().lower()
        display_name = str(getattr(account, "DisplayName", "") or "").strip().lower()
        if requested not in (smtp_address, display_name):
            continue

        try:
            mail.PropertyAccessor.SetProperty(_PR_SENT_REPRESENTING_NAME, account.SmtpAddress)
            mail.PropertyAccessor.SetProperty(_PR_SENT_REPRESENTING_ADDRTYPE, "SMTP")
            mail.PropertyAccessor.SetProperty(_PR_SENT_REPRESENTING_EMAIL_ADDRESS, account.SmtpAddress)
        except Exception:  # noqa: BLE001 - best-effort; SendUsingAccount below still routes correctly
            pass
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


BODY_FONT_FAMILY = "Arial"
BODY_FONT_SIZE_PT = 10


def _set_body(mail, body_text: str):
    """
    Always HTML now (Vincent, 2026-08-18: wants every draft to render in a
    fixed font/size, not whatever a given machine's own Outlook default
    happens to be — a plain-text .Body carries no font info at all, so
    forcing Arial/10pt requires HTML regardless of whether this particular
    template has a payment section). Only embeds the payment-options image
    when the text actually reaches the PAYMENT_MARKER line.
    """
    body_text = body_text or ""
    html_body = (
        f'<div style="font-family:{BODY_FONT_FAMILY},sans-serif;'
        f'font-size:{BODY_FONT_SIZE_PT}pt;">{_plain_text_to_html(body_text)}</div>'
    )
    if PAYMENT_MARKER not in body_text.upper():
        mail.HTMLBody = html_body
        return

    image_path = _asset_path("payment_options.png")
    if os.path.isfile(image_path):
        attachment = mail.Attachments.Add(image_path)
        # PR_ATTACH_CONTENT_ID (MAPI) — marks this attachment as the inline
        # image the cid: reference below points to.
        attachment.PropertyAccessor.SetProperty(
            "http://schemas.microsoft.com/mapi/proptag/0x3712001E", PAYMENT_IMAGE_CID,
        )
        # PR_ATTACHMENT_HIDDEN — without this, Content-ID alone still isn't
        # enough for every receiving client to treat it as purely inline;
        # Gmail in particular kept listing it as a separate downloadable
        # attachment ("3 Attachments") even though it also rendered inline
        # in the body (Vincent, 2026-08-18, screenshot of a received copy).
        attachment.PropertyAccessor.SetProperty(
            "http://schemas.microsoft.com/mapi/proptag/0x7FFE000B", True,
        )
        # Vincent, 2026-08-18: explicit physical size — 14cm x 7cm. First
        # attempt used a CSS style="width:14cm;height:7cm" — Outlook's own
        # HTML renderer (Word-based, not a browser engine) silently ignores
        # CSS sizing on <img> and just shows the image at its native pixel
        # size instead (confirmed: Vincent's Picture Format panel showed
        # 46.95 x 23.47cm, exactly the source file's 1774x887px at the
        # standard 96 DPI, i.e. the style attribute had zero effect). The
        # classic HTML width/height attributes (pixels only, no cm) are
        # what it actually respects — 14cm/7cm at 96 DPI rounds to 529x265.
        # Kept as a matching CSS style too for any non-Outlook recipient
        # whose own client reads inline style instead of the attributes.
        html_body += (
            f'<br><img src="cid:{PAYMENT_IMAGE_CID}" '
            f'width="529" height="265" style="width:529px;height:265px;">'
        )
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
    start_sent_items_reconciler()
    app.run(host="127.0.0.1", port=PORT, threaded=True)

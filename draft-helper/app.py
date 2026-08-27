"""
Tassure Draft Helper — local HTTP service that lets the Client Communications
page in the tassure-invoice web app drive real Outlook via COM automation.
Two modes: POST /drafts/open calls .Display() only, for a human to review
and send manually (matching the legacy BULK.xlsm macro's behaviour). POST
/drafts/send calls .Save() then .Send() directly — used by the web app's own
Outlook-style review screen, where the human already reviewed and clicked
Send there; the synchronous HTTP response (success or a thrown error) is the
web app's only source of truth for whether the email actually went out, no
separate "did it send" detection needed.

Bound to 127.0.0.1 only; never reachable from the network.
"""
import base64
import html
import os
import re
import shutil
import sys
import tempfile
import threading
import winreg

import pythoncom
import win32com
import win32com.client
from flask import Flask, jsonify, request
from flask_cors import CORS

# Historical note, kept because the gen_py rerouting below is otherwise
# unexplained: this originally existed for DispatchWithEvents, which caught
# Outlook's ItemSend event as part of the auto-detected "sent" mechanism
# removed 2026-08-26 (see /drafts/send's docstring on _send_one_draft for
# why detection was replaced by a synchronous .Send() call instead). Nothing
# left in this file calls DispatchWithEvents — every Outlook.Application
# dispatch here is the plain, late-bound win32com.client.Dispatch, which
# never needed a pre-generated typelib cache. Left in place rather than
# torn out: harmless if inert, and removing it means also touching
# TassureDraftHelper.spec/build.ps1/BUILD.md's bundled-data wiring for a
# cleanup that isn't blocking anything.
# Same base-path resolution as _asset_path below.
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
VERSION = "1.7.3"

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
    Assign the exact Outlook account selected in the web workbench —
    SendUsingAccount only, same technique the legacy BULK.xlsm macro always
    used (Session.Accounts, matched by DisplayName, .SendUsingAccount = acc,
    nothing else).

    History, so the next person doesn't re-add what this deliberately
    removed: 2026-08-19 found SendUsingAccount alone displaying the
    profile's primary account instead of the one requested, and tried
    fixing it by also assigning .Sender to the account's own AddressEntry —
    2026-08-20 confirmed live that this broke sending outright on the
    Exchange/M365-backed accounts this tool actually targets ("Something
    went wrong", From showing a raw LegacyExchangeDN string). The fix at
    the time was writing the PR_SENT_REPRESENTING_* MAPI properties
    directly as an explicit SMTP identity instead of touching .Sender.

    Vincent, 2026-08-26: pointed out the legacy macro never needed any of
    that — it only ever set SendUsingAccount, on the very same kind of
    account, and it worked. The missing piece was never the sender
    identity itself — removed PR_SENT_REPRESENTING_*, back to exactly the
    legacy macro's approach, and theorized _open_one_draft's new mail.Save()
    call (giving the item a real EntryID before Display()) was what made an
    unsaved item's COM-assigned account carry through to what the UI (and
    the actual send) treat as bound.

    2026-08-27: that theory was wrong, or at least incomplete — a real
    Chelsea test after it shipped still sent from the wrong account. Only
    truly resolved by going back to BULK.xlsm's actual VBA source (extracted
    with olevba, since this machine's Excel has "trust access to the VBA
    project" off) and diffing it line by line against this file, rather
    than continuing to theorize: the macro calls .GetInspector — a side
    effect of how it pastes its Word-built body in, not a deliberate
    fix — immediately after SendUsingAccount, before anything else is set.
    This file never did that; see _open_one_draft's and _send_one_draft's
    own comments for the actual fix now in place. Save() is left in, not
    because it's confirmed load-bearing, but because nothing here
    contradicts it and removing an unconfirmed-harmless line just to tidy
    up isn't worth the risk of reintroducing whatever it may still help
    with.
    """
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


def _normalize_recipients(raw: str) -> str:
    """
    Chelsea, 2026-08-27: first real Send() call with a multi-recipient CC
    failed outright — 'Outlook does not recognize one or more names.'
    (-2147352567 / DISP_E_EXCEPTION). Root cause: the web app stores a
    multiple-recipient To/CC as NEWLINE-joined text (recipientLines() in
    lib/campaign-recipients.ts), and this file assigned that raw string
    straight to mail.To/mail.CC/mail.BCC — but Outlook's own convention for
    those properties is a SEMICOLON-separated list; a literal embedded
    newline isn't a recognized separator at all. This never surfaced
    through .Display() (_open_one_draft has the exact same raw assignment,
    unfixed until now) because Display() doesn't force name resolution —
    a human sees the compose window and Outlook only resolves/validates
    names lazily, often not erroring even when a field is malformed, and a
    person could always retype a garbled field before manually clicking
    Send. .Send() resolves immediately and hard-fails the instant it hits
    one — no human left to notice or fix it first. Splits on any separator
    that has turned up in practice (newline, comma, semicolon) and rejoins
    with '; ', matching lib/draft-helper-client.ts's own normalizeRecipients
    (used today only for the mailto: fallback link — this is the same fix,
    applied where it was actually missing).
    """
    if not raw:
        return raw
    parts = re.split(r"[;,\n\r]+", raw)
    return "; ".join(p.strip() for p in parts if p.strip())


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
        # Vincent, 2026-08-27: Save() below was never actually the fix — a
        # real Chelsea test after it shipped still sent from the wrong
        # account. Extracted BULK.xlsm's real VBA source (olevba, since this
        # machine's Excel has "trust access to the VBA project" off) and
        # diffed it against this function line by line: the macro calls
        # .GetInspector — as an incidental side effect of how it pastes the
        # Word-built body into the item, not a deliberate fix — immediately
        # after SendUsingAccount, before To/CC/Subject/body/attachments are
        # ever touched. This file never did that at all; .HTMLBody is a
        # plain property write with no Inspector involved, and the only
        # GetInspector-triggering call was Display() at the very end, after
        # everything else was already set. Realizing the Inspector this
        # early appears to be what actually binds the compose window's From
        # selection to the account just assigned, before Outlook's own later
        # property writes get a chance to silently re-default it — matching
        # the macro's own working order exactly, not guessing at a new one.
        #
        # Closed again immediately (discarding — nothing to lose, nothing
        # past the sender is set on it yet) rather than left open: tested
        # directly, an Inspector still attached to this MailItem when .Send()
        # later runs makes .Send() itself throw "(-2147024809, 'The
        # parameter is incorrect.')" — Display() at the bottom of this
        # function re-opens a real window regardless, and closing here first
        # doesn't lose the binding effect (verified directly too, both ways).
        mail.GetInspector().Close(1)  # 1 = olDiscard
        mail.To = _normalize_recipients(draft.get("to") or "")
        mail.CC = _normalize_recipients(draft.get("cc") or "")
        mail.Subject = draft.get("subject") or ""
        _set_body(mail, draft.get("body"))

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

        # Kept alongside GetInspector above, not replaced by it — harmless
        # either way, and Save() giving the item a real EntryID before
        # Display() may still matter for reasons unrelated to the sender
        # binding specifically.
        mail.Save()
        mail.Display()
        return {"ok": True}
    except Exception as e:  # noqa: BLE001 - report per-draft, never crash the batch
        return {"ok": False, "error": str(e)}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _send_one_draft(outlook, draft: dict) -> dict:
    """
    Same as _open_one_draft, except it calls .Send() directly instead of
    .Display() — used by the web app's own Outlook-style review screen,
    where a human already reviewed and clicked Send there. No DRAFT_ID_PROP
    tagging: this response IS the confirmation, synchronously — the caller
    already knows the draft's own id locally and doesn't need it echoed
    back through the MailItem the way the old event-listener/reconciler
    mechanism (removed 2026-08-26) needed to identify what got sent later.

    Calls mail.GetInspector().Close(1) right after _assign_sender, same as
    _open_one_draft now does (see that function's own comment for the full
    story: diffed against BULK.xlsm's real VBA source after Save() alone
    proved insufficient on a real Chelsea test — sent from the wrong account
    despite it). Closing immediately isn't just tidiness here — it's
    required: tested directly, an Inspector still attached when .Send()
    later runs makes .Send() itself throw "(-2147024809, 'The parameter is
    incorrect.')" (first tried leaving it open with Visible = False, to
    avoid flashing a compose window open on a path with no human meant to
    see one — that hit exactly this error). Closing it immediately still
    keeps the realize/bind effect the fix depends on (verified directly,
    both with and without the immediate close) while leaving Send() able to
    run — and as a side benefit, means nothing ever flashes on screen here
    at all, not even best-effort.

    Untested territory, flagged rather than assumed safe: nothing in this
    codebase (nor the legacy BULK.xlsm macro before it) has ever called
    .Send() programmatically before — only Display(), for a human to send
    manually. The main unknown is whether Outlook's Object Model Guard ("a
    program is trying to send mail on your behalf") fires for a
    COM-initiated Send() the way it can for some Outlook security
    configurations — if it does, this call blocks on a modal dialog nobody
    is there to click, rather than raising. Needs a real test against the
    actual finance@/contact@ Microsoft 365 accounts this targets.
    """
    tmp_dir = tempfile.mkdtemp(prefix="tassure-draft-")
    try:
        mail = outlook.CreateItem(0)  # olMailItem
        _assign_sender(outlook, mail, draft.get("senderEmail") or "")
        mail.GetInspector().Close(1)  # 1 = olDiscard
        mail.To = _normalize_recipients(draft.get("to") or "")
        mail.CC = _normalize_recipients(draft.get("cc") or "")
        mail.BCC = _normalize_recipients(draft.get("bcc") or "")
        mail.Subject = draft.get("subject") or ""
        _set_body(mail, draft.get("body"))

        for att in draft.get("attachments") or []:
            file_name = att.get("fileName") or "attachment.pdf"
            safe_name = os.path.basename(file_name).replace("\\", "_").replace("/", "_")
            file_path = os.path.join(tmp_dir, safe_name)
            with open(file_path, "wb") as f:
                f.write(base64.b64decode(att["base64"]))
            mail.Attachments.Add(file_path)

        if not draft.get("skipStandingAttachments"):
            for name in STANDING_ATTACHMENTS:
                path = _asset_path(name)
                if os.path.isfile(path):
                    mail.Attachments.Add(path)

        mail.Save()
        mail.Send()
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


@app.post("/drafts/send")
def send_drafts():
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
                results.append(_send_one_draft(outlook, draft))
    finally:
        pythoncom.CoUninitialize()

    return jsonify({"results": results})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, threaded=True)

"""Generate the formal Chinese user manual for TASSURE Corporate Services System.

The document is generated from structured content and verified production
screenshots.  All document furniture is monochrome; only the TASSURE logo and
the system screenshots retain their original colour.
"""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    Flowable,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
OUTPUT_FILE = OUTPUT_DIR / "Tassure-Corporate-Services-System-User-Manual-ZH.pdf"
LOGO = ROOT / "public" / "logo.png"
SCREENSHOT_DIR = ROOT / "tmp" / "manual-screenshots-real"

PAGE_W, PAGE_H = A4
NAVY = colors.black
NAVY_DARK = colors.black
TEAL = colors.black
TEAL_LIGHT = colors.white
BLUE = colors.black
BLUE_LIGHT = colors.white
GREEN = colors.black
GREEN_LIGHT = colors.white
AMBER = colors.black
AMBER_LIGHT = colors.white
RED = colors.black
RED_LIGHT = colors.white
SLATE = colors.black
MUTED = colors.black
LINE = colors.HexColor("#B8B8B8")
PAPER = colors.white


def register_fonts() -> None:
    regular = Path(r"C:\Windows\Fonts\msyh.ttc")
    bold = Path(r"C:\Windows\Fonts\msyhbd.ttc")
    if not regular.exists() or not bold.exists():
        raise FileNotFoundError("Microsoft YaHei font files were not found in C:\\Windows\\Fonts")
    pdfmetrics.registerFont(TTFont("MicrosoftYaHei", str(regular), subfontIndex=0))
    pdfmetrics.registerFont(TTFont("MicrosoftYaHei-Bold", str(bold), subfontIndex=0))
    pdfmetrics.registerFontFamily(
        "MicrosoftYaHei",
        normal="MicrosoftYaHei",
        bold="MicrosoftYaHei-Bold",
        italic="MicrosoftYaHei",
        boldItalic="MicrosoftYaHei-Bold",
    )


register_fonts()


class ManualDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        super().__init__(filename, **kwargs)
        self._heading_counter = 0

    def beforeDocument(self):
        # ``multiBuild`` lays out the document repeatedly until the table of
        # contents stabilises.  Reusing the counter across passes would create
        # different bookmark keys on every pass, so the TOC could never settle.
        self._heading_counter = 0

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        style_name = flowable.style.name
        if style_name not in {"H1", "H2", "H3"}:
            return
        level = {"H1": 0, "H2": 1, "H3": 2}[style_name]
        text = flowable.getPlainText()
        self._heading_counter += 1
        key = f"heading-{self._heading_counter}"
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level, closed=False)
        self.notify("TOCEntry", (level, text, self.page, key))


class InterfaceFigure(Flowable):
    """Vector interface illustration with anonymised sample records."""

    def __init__(self, kind: str, width: float = 170 * mm, height: float = 78 * mm):
        super().__init__()
        self.kind = kind
        self.width = width
        self.height = height

    def wrap(self, avail_width, avail_height):
        return min(self.width, avail_width), self.height

    def _txt(self, c, x, y, text, size=7, color=SLATE, bold=False, align="left"):
        c.setFont("MicrosoftYaHei-Bold" if bold else "MicrosoftYaHei", size)
        c.setFillColor(color)
        if align == "center":
            c.drawCentredString(x, y, text)
        elif align == "right":
            c.drawRightString(x, y, text)
        else:
            c.drawString(x, y, text)

    def _pill(self, c, x, y, text, bg=BLUE_LIGHT, fg=BLUE, w=None, h=14):
        if w is None:
            w = max(34, len(text) * 6 + 14)
        c.setFillColor(bg)
        c.setStrokeColor(colors.Color(fg.red, fg.green, fg.blue, alpha=0.24))
        c.roundRect(x, y, w, h, h / 2, fill=1, stroke=1)
        self._txt(c, x + w / 2, y + 4.2, text, 6.1, fg, True, "center")
        return w

    def _screen(self, c):
        w, h = self.width, self.height
        c.setFillColor(colors.white)
        c.setStrokeColor(LINE)
        c.roundRect(0, 0, w, h, 10, fill=1, stroke=1)
        c.setFillColor(colors.HexColor("#FAFCFE"))
        c.roundRect(0, h - 22, w, 22, 10, fill=1, stroke=0)
        c.setFillColor(NAVY)
        c.roundRect(0, 0, 43, h, 10, fill=1, stroke=0)
        c.rect(33, 0, 10, h, fill=1, stroke=0)
        self._txt(c, 8, h - 14, "TASSURE", 6.3, colors.white, True)
        for i, text in enumerate(["Dashboard", "Companies", "Master List", "Billing System"]):
            yy = h - 39 - i * 18
            if i == 3:
                c.setFillColor(colors.Color(1, 1, 1, alpha=0.10))
                c.roundRect(5, yy - 5, 33, 15, 5, fill=1, stroke=0)
            self._txt(c, 8, yy, text, 5.1, colors.HexColor("#E5EEF8"), i == 3)
        return 51, h - 31, w - 59, h - 39

    def draw(self):
        c = self.canv
        c.saveState()
        x0, y0, cw, ch = self._screen(c)
        method = getattr(self, f"_draw_{self.kind}", self._draw_navigation)
        method(c, x0, y0, cw, ch)
        c.restoreState()

    def _draw_navigation(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "系统导航与账户区", 10, NAVY_DARK, True)
        self._txt(c, x, y - 7, "页面名称", 6.5, MUTED)
        c.setFillColor(colors.white)
        c.setStrokeColor(LINE)
        c.roundRect(x, y - 54, w, 37, 7, fill=1, stroke=1)
        self._txt(c, x + 12, y - 32, "Vincent Seow", 7.5, NAVY, True)
        self._txt(c, x + 12, y - 44, "vincent@tassure.com", 6, MUTED)
        c.setFillColor(colors.white)
        c.setStrokeColor(LINE)
        c.roundRect(x + w - 62, y - 45, 50, 20, 6, fill=1, stroke=1)
        self._txt(c, x + w - 37, y - 38, "Logout", 6.5, NAVY, True, "center")
        self._txt(c, x, 12, "左侧菜单可展开或收起；右上角显示当前账户与登出按钮。", 6.2, SLATE)

    def _draw_dashboard(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "Portfolio Overview", 10, NAVY_DARK, True)
        self._txt(c, x, y - 7, "运营总览、导出、连接状态与异常入口", 6.2, MUTED)
        self._pill(c, x + w - 94, y - 10, "Export Company Data", TEAL_LIGHT, TEAL, 90, 16)
        c.setFillColor(AMBER_LIGHT)
        c.setStrokeColor(colors.HexColor("#F4C98B"))
        c.roundRect(x, y - 39, w, 21, 7, fill=1, stroke=1)
        self._txt(c, x + 9, y - 31, "Automation health", 6.5, NAVY, True)
        self._pill(c, x + 84, y - 35, "TeamWork", GREEN_LIGHT, GREEN, 48, 13)
        self._pill(c, x + 136, y - 35, "QuickBooks", GREEN_LIGHT, GREEN, 54, 13)
        self._txt(c, x + w - 8, y - 31, "integration exceptions", 5.7, AMBER, True, "right")
        hero_y = y - 103
        c.setFillColor(colors.HexColor("#204A60"))
        c.roundRect(x, hero_y, w * 0.68, 54, 8, fill=1, stroke=0)
        self._txt(c, x + 12, hero_y + 36, "Operational picture", 11, colors.white, True)
        self._txt(c, x + 12, hero_y + 21, "Active portfolio     Next 6 months     Needs attention", 6.3, colors.HexColor("#D5F1EB"))
        c.setFillColor(colors.white)
        c.setStrokeColor(LINE)
        c.roundRect(x + w * 0.70, hero_y, w * 0.30, 54, 8, fill=1, stroke=1)
        self._txt(c, x + w * 0.72, hero_y + 38, "Action Centre", 7.5, NAVY, True)
        self._txt(c, x + w * 0.72, hero_y + 24, "Late filing review", 6.0, RED)
        self._txt(c, x + w * 0.72, hero_y + 12, "AR preparation window", 6.0, AMBER)
        self._txt(c, x, 11, "点击自动化健康栏可展开查看每一项异常详情。", 6.2, SLATE)

    def _draw_companies(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "Companies", 10, NAVY_DARK, True)
        labels = [("All Companies", NAVY), ("Active", GREEN), ("Striking Off", RED), ("Active ND", colors.HexColor("#7C3AED")), ("Address Service", BLUE)]
        card_w = (w - 16) / len(labels)
        for i, (label, col) in enumerate(labels):
            xx = x + i * (card_w + 4)
            c.setFillColor(colors.white)
            c.setStrokeColor(LINE)
            c.roundRect(xx, y - 28, card_w, 26, 5, fill=1, stroke=1)
            self._txt(c, xx + 5, y - 13, str(120 + i * 7), 8.5, col, True)
            self._txt(c, xx + 5, y - 23, label, 4.7, SLATE, True)
        self._table_stub(c, x, y - 101, w, ["Company Name", "Status", "UEN", "Type", "ND", "Address", "PIC"], [170, 64, 72, 54, 70, 70, 60])

    def _draw_master(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "Master List - Active Client", 10, NAVY_DARK, True)
        for i, (label, col) in enumerate([("Total Records", NAVY), ("FYE Mismatch", RED), ("Has Nominee Dir", colors.HexColor("#7C3AED")), ("MAS Regulated", BLUE), ("Non-TeamWork", AMBER)]):
            xx = x + i * (w / 5)
            self._pill(c, xx, y - 18, label, colors.white, col, w / 5 - 4, 15)
        c.setFillColor(colors.white)
        c.setStrokeColor(LINE)
        c.roundRect(x, y - 45, w, 20, 6, fill=1, stroke=1)
        self._txt(c, x + 8, y - 37, "Search company name or ROC No...", 5.8, MUTED)
        self._pill(c, x + w - 58, y - 42, "+ Add Manual", TEAL_LIGHT, TEAL, 54, 14)
        self._table_stub(c, x, y - 104, w, ["Company", "UEN", "Active", "FYE", "PIC", "Remark"], [180, 80, 54, 54, 70, 120])

    def _draw_nd(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "Nominee Directors", 10, NAVY_DARK, True)
        c.setFillColor(AMBER_LIGHT)
        c.setStrokeColor(colors.HexColor("#F4C98B"))
        c.roundRect(x, y - 47, w, 36, 7, fill=1, stroke=1)
        self._txt(c, x + 10, y - 25, "TeamWork subrole review", 7, NAVY, True)
        self._txt(c, x + 10, y - 38, "3 条件同时满足：Subrole 空白 + 有就任日期 + 离任日期空白", 5.6, SLATE)
        self._pill(c, x + w - 72, y - 35, "17 to confirm", AMBER_LIGHT, AMBER, 64, 14)
        self._table_stub(c, x, y - 105, w, ["ND Person", "Active", "Company", "Appointment", "Status"], [120, 60, 190, 80, 70])

    def _draw_address(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "Address Service", 10, NAVY_DARK, True)
        for i, text in enumerate(["Total clients", "By company type", "Registered address"]):
            xx = x + i * (w / 3)
            c.setFillColor(colors.white)
            c.setStrokeColor(LINE)
            c.roundRect(xx, y - 38, w / 3 - 6, 30, 6, fill=1, stroke=1)
            self._txt(c, xx + 7, y - 21, text, 6.5, NAVY, True)
            self._txt(c, xx + 7, y - 32, "Live TeamWork data", 5.2, MUTED)
        self._table_stub(c, x, y - 104, w, ["Company Name", "UEN", "Type", "Contact", "PIC"], [190, 90, 70, 120, 70])

    def _draw_ar_list(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "AR Reminder - List View", 10, NAVY_DARK, True)
        for i, (label, col) in enumerate([("Total", NAVY), ("AR Filed", GREEN), ("In Progress", AMBER), ("Not Started", MUTED), ("Overdue", RED)]):
            self._pill(c, x + i * (w / 5), y - 18, label, colors.white, col, w / 5 - 4, 15)
        headers = ["Company", "UEN", "Services", "Due Date", "PIC"]
        self._table_stub(c, x, y - 105, w, headers, [180, 74, 200, 74, 70], rows=3, service_pills=True)
        self._txt(c, x, 10, "蓝色=系统自动识别，绿色圆点=人工开启，灰色=关闭。", 5.9, SLATE)

    def _draw_ar_table(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "AR Reminder - Table View", 10, NAVY_DARK, True)
        cols = ["#", "Company", "UEN", "Reminder", "Report Ready", "AGM", "To Client", "Signed", "AR", "XBRL", "SEC PIC"]
        widths = [18, 110, 55, 55, 62, 44, 52, 48, 44, 44, 55]
        self._table_stub(c, x, y - 101, w, cols, widths, rows=3, date_pills=True)
        self._txt(c, x, 10, "首三列和表头固定；点击单元格编辑，日期统一显示 03 Apr 2026。", 5.9, SLATE)

    def _draw_ar_modal(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "AR 公司详情弹窗", 10, NAVY_DARK, True)
        c.setFillColor(NAVY)
        c.roundRect(x, y - 45, w, 36, 7, fill=1, stroke=0)
        self._txt(c, x + 9, y - 23, "示例客户有限公司", 7.5, colors.white, True)
        self._txt(c, x + 9, y - 37, "UEN 202600001A  |  FYE 31 Dec 2026  |  120d left", 5.5, colors.HexColor("#DCEBFA"))
        c.setFillColor(colors.white)
        c.setStrokeColor(LINE)
        c.roundRect(x + 8, y - 109, w - 16, 56, 6, fill=1, stroke=1)
        self._txt(c, x + 16, y - 66, "Service configuration", 6.8, NAVY, True)
        first_row = [
            ("Annual Return LOCKED", BLUE_LIGHT, BLUE, 118),
            ("AGM LOCKED", BLUE_LIGHT, BLUE, 76),
            ("Secretary AUTO ON", colors.HexColor("#F5F3FF"), colors.HexColor("#6D28D9"), 108),
        ]
        second_row = [
            ("Accounts AUTO OFF", PAPER, MUTED, 108),
            ("XBRL MANUAL ON", GREEN_LIGHT, GREEN, 104),
        ]
        for row_y, items in ((y - 86, first_row), (y - 103, second_row)):
            xx = x + 16
            for text, bg, fg, pill_width in items:
                self._pill(c, xx, row_y, text, bg, fg, pill_width, 14)
                xx += pill_width + 5
        self._txt(c, x, 10, "History 可查看变更者与时间；Restore 会在无更新冲突时还原。", 5.9, SLATE)

    def _draw_late(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "Late Filing", 10, NAVY_DARK, True)
        cards = [("Total", NAVY), ("Seriously Overdue", RED), ("Recently Overdue", colors.HexColor("#EA580C")), ("Habitual Risk", colors.HexColor("#CA8A04")), ("Under Review", MUTED), ("Resolved", TEAL)]
        for i, (label, col) in enumerate(cards):
            self._pill(c, x + i * (w / 6), y - 18, label, colors.white, col, w / 6 - 4, 15)
        self._table_stub(c, x, y - 105, w, ["Company", "UEN", "FYE", "Late FY", "Next AGM Due", "Remarks", "Action"], [150, 70, 40, 52, 90, 125, 48], rows=3, late=True)

    def _draw_billing_list(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "Billing Drafts", 10, NAVY_DARK, True)
        self._pill(c, x, y - 18, "AR Reminder batch", BLUE_LIGHT, NAVY, 95, 15)
        self._pill(c, x + 100, y - 18, "Needs Billing", AMBER_LIGHT, AMBER, 76, 15)
        self._pill(c, x + 181, y - 18, "Invoiced", GREEN_LIGHT, GREEN, 62, 15)
        self._table_stub(c, x, y - 105, w, ["Company", "Billing Status", "FYE", "Renewal", "ND TAC", "Annual", "TAB Invoice", "TAC Invoice", "PIC"], [128, 74, 42, 88, 58, 88, 72, 72, 56], rows=3, billing=True)

    def _draw_invoice_builder(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "Invoice Builder", 10, NAVY_DARK, True)
        self._txt(c, x, y - 8, "Client email                         Invoice date                         SEC / XBRL PIC", 5.8, MUTED)
        self._pill(c, x, y - 31, "TAB - Basic Services", BLUE_LIGHT, BLUE, 100, 15)
        self._pill(c, x + w - 89, y - 31, "Next #0261XXXX", PAPER, NAVY, 85, 15)
        self._table_stub(c, x, y - 79, w, ["Use", "Service", "Description", "Status", "Qty", "Rate", "Amount"], [34, 84, 180, 70, 35, 60, 65], rows=2)
        self._pill(c, x, 12, "TAC - Nominee Director", AMBER_LIGHT, AMBER, 114, 15)
        self._pill(c, x + w - 116, 12, "Generate 2 Invoices", TEAL_LIGHT, TEAL, 112, 15)

    def _draw_automation(self, c, x, y, w, h):
        self._txt(c, x, y + 6, "自动化更新时间表 (Singapore Time)", 10, NAVY_DARK, True)
        items = [
            ("08:00", "TeamWork ND"), ("08:30", "TeamWork Companies"),
            ("09:00", "AR Generate"), ("09:30", "QB Full Sync"),
            ("10:00", "AR Workflow"), ("11:00", "Late Filing"),
        ]
        line_y = y - 51
        c.setStrokeColor(colors.HexColor("#A7C8C2"))
        c.setLineWidth(2)
        c.line(x + 16, line_y, x + w - 16, line_y)
        for i, (tm, label) in enumerate(items):
            xx = x + 16 + i * ((w - 32) / (len(items) - 1))
            c.setFillColor(TEAL)
            c.circle(xx, line_y, 4, fill=1, stroke=0)
            self._txt(c, xx, line_y + 12, tm, 6.8, NAVY, True, "center")
            self._txt(c, xx, line_y - 16, label, 4.8, SLATE, False, "center")
        self._pill(c, x + w / 2 - 58, 11, "QB Webhook - change driven", BLUE_LIGHT, BLUE, 116, 15)

    def _table_stub(self, c, x, y, w, headers, widths, rows=3, service_pills=False, date_pills=False, late=False, billing=False):
        total = sum(widths)
        scale = w / total
        widths = [v * scale for v in widths]
        header_h = 15
        row_h = 17
        c.setFillColor(NAVY)
        c.roundRect(x, y, w, header_h + rows * row_h, 5, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.rect(x, y, w, rows * row_h, fill=1, stroke=0)
        xx = x
        for header, ww in zip(headers, widths):
            self._txt(c, xx + ww / 2, y + rows * row_h + 5.2, header, 4.5, colors.white, True, "center")
            c.setStrokeColor(colors.Color(1, 1, 1, alpha=0.15))
            c.line(xx + ww, y + rows * row_h, xx + ww, y + rows * row_h + header_h)
            xx += ww
        for r in range(rows):
            yy = y + (rows - 1 - r) * row_h
            if r % 2:
                c.setFillColor(colors.HexColor("#F8FAFC"))
                c.rect(x, yy, w, row_h, fill=1, stroke=0)
            c.setStrokeColor(colors.HexColor("#EDF1F5"))
            c.line(x, yy, x + w, yy)
            xx = x
            for idx, ww in enumerate(widths):
                if idx == 0:
                    self._txt(c, xx + 4, yy + 6, "示例客户" if ww > 65 else str(r + 1), 4.7, SLATE, idx == 0 and ww > 65)
                elif service_pills and idx == 2:
                    pxx = xx + 3
                    for t, fg in [("AR", BLUE), ("AGM", colors.HexColor("#4338CA")), ("SEC", colors.HexColor("#6D28D9"))]:
                        pxx += self._pill(c, pxx, yy + 2.5, t, colors.white, fg, 24, 11) + 2
                elif date_pills and idx >= 3:
                    self._pill(c, xx + 2, yy + 2.5, "03 Apr", GREEN_LIGHT, GREEN, max(28, ww - 4), 11)
                elif late and idx == 4:
                    self._pill(c, xx + 2, yy + 2.5, "OVERDUE", RED_LIGHT, RED, max(34, ww - 4), 11)
                elif late and idx == 6:
                    self._pill(c, xx + 3, yy + 2.5, "Resolve", TEAL_LIGHT, TEAL, max(30, ww - 6), 11)
                elif billing and idx in {1, 3, 4, 5, 6, 7}:
                    txt = {1: "To invoice", 3: "SEC", 4: "ND", 5: "AR", 6: "Not issued", 7: "Not issued"}.get(idx, "-")
                    fg = AMBER if idx == 1 else GREEN if idx in {3, 4, 5} else MUTED
                    bg = AMBER_LIGHT if idx == 1 else GREEN_LIGHT if idx in {3, 4, 5} else PAPER
                    self._pill(c, xx + 2, yy + 2.5, txt, bg, fg, max(30, ww - 4), 11)
                elif idx > 0:
                    self._txt(c, xx + ww / 2, yy + 6, "-", 5, MUTED, False, "center")
                xx += ww


def build_styles():
    sample = getSampleStyleSheet()
    styles = {}
    styles["CoverTitle"] = ParagraphStyle(
        "CoverTitle", parent=sample["Title"], fontName="MicrosoftYaHei-Bold",
        fontSize=27, leading=38, textColor=colors.black, alignment=TA_LEFT,
        spaceAfter=12,
    )
    styles["CoverSub"] = ParagraphStyle(
        "CoverSub", parent=sample["Normal"], fontName="MicrosoftYaHei",
        fontSize=12, leading=20, textColor=colors.black,
    )
    styles["H1"] = ParagraphStyle(
        "H1", parent=sample["Heading1"], fontName="MicrosoftYaHei-Bold",
        fontSize=19, leading=27, textColor=NAVY_DARK, spaceBefore=8, spaceAfter=10,
        keepWithNext=True,
    )
    styles["H2"] = ParagraphStyle(
        "H2", parent=sample["Heading2"], fontName="MicrosoftYaHei-Bold",
        fontSize=13.5, leading=20, textColor=NAVY, spaceBefore=10, spaceAfter=7,
        keepWithNext=True,
    )
    styles["H3"] = ParagraphStyle(
        "H3", parent=sample["Heading3"], fontName="MicrosoftYaHei-Bold",
        fontSize=11, leading=17, textColor=TEAL, spaceBefore=8, spaceAfter=5,
        keepWithNext=True,
    )
    styles["Body"] = ParagraphStyle(
        "Body", parent=sample["BodyText"], fontName="MicrosoftYaHei",
        fontSize=9.25, leading=16.2, textColor=colors.black, alignment=TA_JUSTIFY,
        spaceAfter=7, wordWrap="CJK",
    )
    styles["Small"] = ParagraphStyle(
        "Small", parent=styles["Body"], fontSize=7.4, leading=12.5, textColor=MUTED,
        spaceAfter=4,
    )
    styles["Bullet"] = ParagraphStyle(
        "Bullet", parent=styles["Body"], leftIndent=14, firstLineIndent=-8,
        bulletIndent=3, spaceAfter=4,
    )
    styles["Number"] = ParagraphStyle(
        "Number", parent=styles["Body"], leftIndent=18, firstLineIndent=-12,
        spaceAfter=5,
    )
    styles["Caption"] = ParagraphStyle(
        "Caption", parent=styles["Small"], alignment=TA_CENTER, textColor=MUTED,
        fontSize=7.2, leading=11, spaceBefore=3, spaceAfter=9,
    )
    styles["TOCHeader"] = ParagraphStyle(
        "TOCHeader", parent=styles["H1"], fontSize=22, leading=30,
    )
    styles["TableCell"] = ParagraphStyle(
        "TableCell", parent=styles["Body"], fontSize=7.5, leading=11.5,
        spaceAfter=0, alignment=TA_LEFT,
    )
    styles["TableHead"] = ParagraphStyle(
        "TableHead", parent=styles["TableCell"], fontName="MicrosoftYaHei-Bold",
        textColor=colors.white, alignment=TA_CENTER,
    )
    styles["CalloutTitle"] = ParagraphStyle(
        "CalloutTitle", parent=styles["Body"], fontName="MicrosoftYaHei-Bold",
        fontSize=9.2, leading=14, spaceAfter=3,
    )
    return styles


STYLES = build_styles()


def para(text: str, style="Body"):
    return Paragraph(text, STYLES[style])


def heading(text: str, level=1):
    return Paragraph(text, STYLES[f"H{level}"])


def bullets(items):
    out = []
    for item in items:
        out.append(Paragraph(f"• {item}", STYLES["Bullet"]))
    return out


def numbered(items):
    out = []
    for idx, item in enumerate(items, 1):
        out.append(Paragraph(f"{idx}. {item}", STYLES["Number"]))
    return out


def callout(title: str, body: str, tone="info"):
    palette = {name: (colors.white, LINE, colors.black) for name in (
        "info", "success", "warning", "danger", "neutral"
    )}
    bg, border, fg = palette[tone]
    data = [[Paragraph(title, ParagraphStyle("ct", parent=STYLES["CalloutTitle"], textColor=fg)), para(body)]]
    t = Table(data, colWidths=[28 * mm, 137 * mm], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.8, border),
        ("LINEBEFORE", (0, 0), (0, -1), 4, fg),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def data_table(headers, rows, widths=None, font_size=7.4, repeat_rows=1):
    head = [Paragraph(str(h), STYLES["TableHead"]) for h in headers]
    body = []
    cell_style = ParagraphStyle("dynamic-cell", parent=STYLES["TableCell"], fontSize=font_size, leading=font_size * 1.55)
    for row in rows:
        body.append([Paragraph(escape(str(v)).replace("\n", "<br/>"), cell_style) for v in row])
    if widths:
        widths = [w * mm for w in widths]
    table = Table([head] + body, colWidths=widths, repeatRows=repeat_rows, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "MicrosoftYaHei-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.white]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


FIGURE_FILES = {
    "navigation": "02-dashboard.png",
    "dashboard": "02-dashboard.png",
    "companies": "03-companies-data.png",
    "master": "04-active-clients-data.png",
    "ad_hoc": "14-ad-hoc.png",
    "mas": "15-mas.png",
    "strike_off": "16-strike-off.png",
    "terminated": "17-terminated.png",
    "name_change": "18-name-change.png",
    "nd": "05-nominee-directors.png",
    "address": "06-address-service.png",
    "ar_list": "07-ar-reminder-data.png",
    "ar_table": "19-ar-table.png",
    "ar_modal": "11-ar-detail-modal.png",
    "ar_history": "12-ar-history.png",
    "late": "08-late-filing-data.png",
    "billing_list": "09-billing-drafts-final.png",
    "invoice_builder": "10-billing-invoice-modal.png",
    "automation": "13-dashboard-automation.png",
    "login": "01-login.png",
}


def figure(kind: str, caption: str, height=86 * mm):
    filename = FIGURE_FILES.get(kind)
    if not filename:
        raise KeyError(f"No screenshot is configured for figure kind: {kind}")
    path = SCREENSHOT_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"Required manual screenshot was not found: {path}")
    px_w, px_h = ImageReader(str(path)).getSize()
    draw_w = 165 * mm
    draw_h = draw_w * px_h / px_w
    if draw_h > height:
        draw_h = height
        draw_w = draw_h * px_w / px_h
    screenshot = Image(str(path), width=draw_w, height=draw_h)
    screenshot.hAlign = "CENTER"
    frame = Table([[screenshot]], colWidths=[draw_w + 2 * mm], hAlign="CENTER")
    frame.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, colors.black),
        ("LEFTPADDING", (0, 0), (-1, -1), 1 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1 * mm),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
    ]))
    return KeepTogether([
        frame,
        Paragraph(f"真实系统截图：{caption}（截取于 17 Jul 2026）", STYLES["Caption"]),
    ])


def draw_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(colors.white)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setStrokeColor(colors.black)
    canvas.setLineWidth(0.9)
    canvas.line(25 * mm, 34 * mm, PAGE_W - 25 * mm, 34 * mm)
    canvas.restoreState()


def draw_body(canvas, doc):
    canvas.saveState()
    page = canvas.getPageNumber()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(18 * mm, PAGE_H - 14 * mm, PAGE_W - 18 * mm, PAGE_H - 14 * mm)
    canvas.setFont("MicrosoftYaHei-Bold", 7.2)
    canvas.setFillColor(colors.black)
    canvas.drawString(18 * mm, PAGE_H - 10.5 * mm, "TASSURE Corporate Services System - 用户操作手册")
    canvas.setFont("MicrosoftYaHei", 6.7)
    canvas.setFillColor(colors.black)
    canvas.drawRightString(PAGE_W - 18 * mm, PAGE_H - 10.5 * mm, "版本 1.1 | 内部使用")
    canvas.line(18 * mm, 13 * mm, PAGE_W - 18 * mm, 13 * mm)
    canvas.drawString(18 * mm, 8.5 * mm, "文档编号：TCS-UM-ZH-001")
    canvas.drawRightString(PAGE_W - 18 * mm, 8.5 * mm, f"第 {page} 页")
    canvas.restoreState()


def create_doc():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = ManualDocTemplate(
        str(OUTPUT_FILE), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=20 * mm, bottomMargin=17 * mm,
        title="TASSURE Corporate Services System 中文用户操作手册",
        author="TASSURE",
        subject="Corporate services operations system user manual",
        creator="TASSURE Corporate Services System",
    )
    cover_frame = Frame(25 * mm, 24 * mm, PAGE_W - 50 * mm, PAGE_H - 48 * mm, id="cover")
    body_frame = Frame(18 * mm, 17 * mm, PAGE_W - 36 * mm, PAGE_H - 37 * mm, id="body")
    doc.addPageTemplates([
        PageTemplate(id="Cover", frames=[cover_frame], onPage=draw_cover),
        PageTemplate(id="Body", frames=[body_frame], onPage=draw_body),
    ])
    return doc


def build_story():
    s = []

    # Cover
    s.append(Spacer(1, 25 * mm))
    if LOGO.exists():
        img = Image(str(LOGO), width=25 * mm, height=25 * mm)
        img.hAlign = "LEFT"
        s.append(img)
        s.append(Spacer(1, 8 * mm))
    s.append(Paragraph("TASSURE Corporate<br/>Services System", STYLES["CoverTitle"]))
    s.append(Paragraph("中文用户操作手册", ParagraphStyle("cover-cn", parent=STYLES["CoverTitle"], fontSize=19, leading=28, textColor=colors.black)))
    s.append(Spacer(1, 8 * mm))
    s.append(Paragraph("适用于公司资料管理、AR 工作流、Late Filing 监控、Billing Draft 与 QuickBooks 开单", STYLES["CoverSub"]))
    s.append(Spacer(1, 35 * mm))
    cover_meta = Table([
        [Paragraph("版本", STYLES["Small"]), Paragraph("1.1", STYLES["Small"])],
        [Paragraph("发布日期", STYLES["Small"]), Paragraph("17 Jul 2026", STYLES["Small"])],
        [Paragraph("系统网址", STYLES["Small"]), Paragraph("https://tassure-corporate-services.vercel.app", STYLES["Small"])],
        [Paragraph("保密级别", STYLES["Small"]), Paragraph("内部使用 / Internal Use Only", STYLES["Small"])],
    ], colWidths=[25 * mm, 105 * mm])
    cover_meta.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "MicrosoftYaHei"),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.black),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    s.append(cover_meta)
    s.append(NextPageTemplate("Body"))
    s.append(PageBreak())

    # Document control
    s.append(heading("文档控制", 1))
    s.append(para("本手册用于指导获准的 TASSURE 员工在网页系统中查看、更新及审核公司服务资料，并完成 AR、Late Filing 与 QuickBooks 开单流程。界面名称保留系统中的英文标签，说明文字采用中文。"))
    s.append(data_table(
        ["项目", "内容"],
        [
            ["文档编号", "TCS-UM-ZH-001"],
            ["版本", "1.1"],
            ["系统", "TASSURE Corporate Services System"],
            ["适用对象", "Corporate Services、Secretarial、Accounts、Tax、Billing 及管理人员"],
            ["适用环境", "桌面版 Chrome / Edge；移动版主要供查看，不建议执行批量编辑或开单"],
            ["日期格式", "统一显示 DD MMM YYYY，例如 03 Apr 2026"],
            ["保密说明", "页面包含客户资料与财务资料，仅限获准人员内部使用，不得转发至外部"],
        ],
        widths=[34, 131],
    ))
    s.append(Spacer(1, 6 * mm))
    s.append(callout("版本说明", "本手册依据 2026 年 7 月 17 日的系统功能及真实系统界面编制。截图中的数量、公司名称和状态为截取时的系统实时资料；后续实际资料以登录后的页面为准。", "info"))
    s.append(Spacer(1, 8 * mm))
    s.append(heading("阅读方式", 2))
    s.extend(bullets([
        "新用户建议依次阅读第 1 至第 3 章，再按岗位阅读相关业务页面。",
        "AR 与 Billing 操作人员必须完整阅读第 7 章及第 10 章。",
        "遇到数据异常时，先确认数据来源，再按第 12 章排查，不要直接以人工覆盖替代源系统修复。",
        "所有页面中的状态卡、状态胶囊和颜色均有业务含义，不应只按颜色判断，仍需阅读文字标签。",
    ]))
    s.append(PageBreak())

    # TOC
    s.append(Paragraph("目录", STYLES["TOCHeader"]))
    s.append(para("目录页码会随文档内容自动更新。点击条目可在支持链接的 PDF 阅读器中跳转。", "Small"))
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("TOC1", fontName="MicrosoftYaHei-Bold", fontSize=10.5, leading=18, leftIndent=0, firstLineIndent=0, textColor=NAVY_DARK, spaceBefore=4),
        ParagraphStyle("TOC2", fontName="MicrosoftYaHei", fontSize=8.7, leading=15, leftIndent=14, firstLineIndent=0, textColor=SLATE),
        ParagraphStyle("TOC3", fontName="MicrosoftYaHei", fontSize=7.8, leading=13, leftIndent=27, firstLineIndent=0, textColor=MUTED),
    ]
    s.append(toc)
    s.append(PageBreak())

    # 1 Overview
    s.append(heading("1. 系统概述", 1))
    s.append(para("TASSURE Corporate Services System 是公司服务运营与开单的统一工作台。它把 TeamWork 的公司与任职资料、Supabase 中的业务记录，以及 QuickBooks 的客户、服务、历史发票和新发票连接起来，让员工在一个网页内完成查看、审核、更新和开单。"))
    s.append(heading("1.1 主要目标", 2))
    s.extend(bullets([
        "统一公司主档、服务状态、FYE、PIC 与联系资料。",
        "按 FYE 批次管理 Annual Return 工作流，记录 Reminder、Report Ready、AGM、To Client、Signed、AR Filing 等节点。",
        "识别 Late Filing 风险，并保留 Under Review 与 Resolved 处理历史。",
        "依据 AR 批次、TeamWork 服务资料及 QuickBooks 历史费用生成 TAB / TAC 发票草稿。",
        "通过自动化健康栏集中显示 TeamWork、QuickBooks 与数据匹配异常。",
    ]))
    s.append(heading("1.2 数据来源与权威级别", 2))
    s.append(data_table(
        ["资料类别", "主要来源", "系统内处理原则"],
        [
            ["公司状态、UEN、公司类型、注册地址", "TeamWork", "应优先在 TeamWork 修正；系统每日同步"],
            ["Nominee Director 当前任职", "TeamWork", "以有 Nominee Director subrole、就任日期且无离任日期为有效在任记录"],
            ["AR 工作流日期与备注", "本系统 / Supabase", "由员工在 AR Reminder 更新；保留变更人、时间与版本"],
            ["服务自动判断", "TeamWork + QuickBooks 历史", "ND / Address 由 TeamWork 管理；部分服务允许人工覆盖"],
            ["历史费用、服务项目、发票状态", "QuickBooks", "系统同步后用于开单建议；开单前再次向 QB 核对号码"],
            ["系统生成发票记录", "本系统 + QuickBooks", "以 QuickBooks Invoice ID 为唯一身份，不以发票号码作为唯一键"],
        ], widths=[42, 44, 79], font_size=7.1,
    ))
    s.append(Spacer(1, 5 * mm))
    s.append(callout("核心原则", "源系统错误应回到源系统修正。人工覆盖只用于业务确认，不应用来长期掩盖 TeamWork 或 QuickBooks 的错误资料。", "warning"))
    s.append(heading("1.3 系统页面结构", 2))
    s.append(data_table(
        ["主菜单", "子页面"],
        [
            ["Dashboard", "Portfolio Overview / Automation health / Export Company Data"],
            ["Companies", "全部公司、状态、ND、Address Service、联系人与 PIC"],
            ["Master List", "Active Client、Ad-Hoc、MAS、Strike Off、Terminated Services、Change Co Name"],
            ["Billing System", "Nominee Directors、Address Service、AR Reminder、Late Filing、Billing Drafts"],
        ], widths=[42, 123],
    ))
    s.append(figure("navigation", "桌面版的导航、账户显示与 Logout 区域"))

    # 2 login
    s.append(heading("2. 登录、Session 与退出", 1))
    s.append(heading("2.1 使用 Google 公司账户登录", 2))
    s.extend(numbered([
        "打开系统网址：https://tassure-corporate-services.vercel.app。",
        "在 Sign In 页面点击 Sign in with Google。",
        "选择已获批准的 TASSURE Google Email。",
        "Google 授权成功后，系统会返回 Dashboard，并在右上角显示规范姓名与 Email。",
    ]))
    s.append(figure("login", "Google 公司账号登录入口"))
    s.append(callout("登录限制", "系统不是只限某一台电脑。任何已获批准的账户都可以在有网络的设备上登录。未列入系统批准名单的 Google 账户会被拒绝。", "info"))
    s.append(heading("2.2 Session 行为", 2))
    s.extend(bullets([
        "登录状态由 Supabase Auth Session 管理，正常情况下刷新页面不会要求重新登录。",
        "如果 Session 过期、被撤销或浏览器清除网站资料，系统会返回登录页。",
        "不要在共用或公共电脑选择浏览器的长期保存账户功能。",
        "开单时，系统会用当前登录 Email 对应的规范姓名写入 QuickBooks Location；未在映射名单中的新账户不会自动创造 QB Location。",
    ]))
    s.append(heading("2.3 正确退出", 2))
    s.extend(numbered([
        "确认没有正在保存的单元格、正在生成的发票或正在下载的 PDF。",
        "点击页面右上角 Logout。",
        "确认系统返回 Sign In 页面。",
    ]))
    s.append(callout("安全要求", "不要仅关闭标签页代替 Logout。若使用共享电脑，完成工作后必须登出 Google 账户和系统。", "danger"))

    # 3 common UI
    s.append(heading("3. 共通界面与操作规范", 1))
    s.append(heading("3.1 左侧导航与页面切换", 2))
    s.extend(bullets([
        "左侧菜单中的 Master List 与 Billing System 可展开或收起。",
        "侧栏顶部的圆形箭头可把菜单收窄为图标模式；设定会保存在当前浏览器。",
        "当前页面会以较亮背景显示。AR Reminder 与 Billing Drafts 共用 /billing 页面，但以不同 tab 区分。",
        "移动版使用独立导航；部分复杂编辑功能只建议在桌面版使用。",
    ]))
    s.append(heading("3.2 搜索、状态卡与分页", 2))
    s.extend(bullets([
        "搜索通常支持公司名称或 UEN / ROC No.；输入后即筛选。",
        "页面上方的统计卡可点击，并会成为当前过滤条件。再次选择 All / Total 可回到全部。",
        "大表格采用分页，通常每页最多 100 条；AR Table View 每页 40 条。",
        "横向大表在底部提供滚动条；固定列在横向移动时仍保持可见。",
    ]))
    s.append(heading("3.3 直接编辑与保存状态", 2))
    s.extend(numbered([
        "点击可编辑的单元格。",
        "输入新内容；日期可直接输入或点日历按钮。",
        "按 Enter 或点击单元格以外位置保存；按 Esc 取消当前输入。",
        "绿色勾表示已保存；橙色点表示正在保存；红色提示表示保存失败。",
        "保存失败时先点 Retry；如内容不应保留，可点 Revert。",
    ]))
    s.append(callout("日期格式", "系统显示格式统一为 03 Apr 2026。可输入 03 Apr 2026、2026-04-03 或清晰的数字日期；含义不明确或无效的日期会被拒绝。", "success"))
    s.append(heading("3.4 状态胶囊的含义", 2))
    s.append(data_table(
        ["颜色", "通常含义", "使用提醒"],
        [
            ["绿色 / 青色", "已完成、有效、已启用、Resolved", "仍需确认文字标签，不能只看颜色"],
            ["蓝色", "系统自动识别、资料来源正常、TAB", "AR 服务中的蓝色通常表示 AUTO ON"],
            ["紫色", "Secretary / 特定专业服务", "属于服务类别颜色，不一定表示完成"],
            ["橙色 / 琥珀色", "即将到期、待开单、需确认、TAC", "应主动检查说明文字"],
            ["红色", "逾期、失败、高风险或冲突", "必须处理，不建议忽略"],
            ["灰色", "关闭、无资料、未开始、Not issued", "可能是尚未执行，也可能是不适用"],
        ], widths=[34, 56, 75],
    ))

    # 4 dashboard
    s.append(heading("4. Dashboard - Portfolio Overview", 1))
    s.append(figure("dashboard", "Dashboard 的主要区域"))
    s.append(heading("4.1 页面用途", 2))
    s.append(para("Dashboard 是管理入口，提供整体客户组合、未来六个月 AR 工作量、Late Filing 风险、服务覆盖、FYE 分布、Nominee Director 工作量及自动化状态。页面上的数字是实时或最近同步资料，不是手工汇报数字。"))
    s.append(heading("4.2 顶部操作", 2))
    s.append(data_table(
        ["控件", "作用", "建议"],
        [
            ["Export Company Data", "下载最新 Excel，内含 Active Clients 与 AR Reminder 两个 Sheet", "下载后检查生成日期；不要把含客户资料的文件发送至外部"],
            ["Refresh", "重新读取 Dashboard 与自动化健康数据", "页面长时间打开后可点击一次"],
            ["TAB / TAC 状态", "显示 QuickBooks 连接日期、状态与 Reconnect", "只有授权失效或明确提示时才重新授权"],
            ["Automation health", "显示同步任务状态、资料异常与待处理明细", "点击整条健康栏展开；按来源和异常类型查看详情"],
        ], widths=[42, 70, 53],
    ))
    s.append(heading("4.3 Automation health 处理方式", 2))
    s.extend(numbered([
        "点击 Automation health 整条横栏。",
        "先查看失败或过期的自动化任务，再查看 integration exceptions。",
        "Unknown PIC ID 应回 TeamWork 修正人员映射；QB duplicate DocNumber 应在 QuickBooks 核对两张不同 Invoice ID 的发票。",
        "不要因为异常数量增加就删除记录；先确认异常类型和来源。",
        "修正源系统后等待下一次同步，或由管理员执行手动同步。",
    ]))
    s.append(callout("关于异常数量", "Automation health 的 items / integration exceptions 是待核对项目数量，不代表系统宕机。ND subrole review 属于业务资料复核，会显示在 Nominee Directors 页面，不计入全局技术故障数量。", "warning"))

    # 5 companies
    s.append(heading("5. Companies 页面", 1))
    s.append(figure("companies", "公司汇总卡、搜索与公司列表"))
    s.append(heading("5.1 页面用途", 2))
    s.append(para("Companies 提供公司主档的快速总览。它适合确认客户生命周期、UEN、公司类型、当前 Nominee Director、注册地址服务、联系人与 PIC。页面不是主要编辑入口；需要修改主档时，应优先在 TeamWork 处理。"))
    s.append(heading("5.2 分类卡", 2))
    s.append(data_table(
        ["分类", "定义"],
        [
            ["All Companies", "系统内全部公司主档"],
            ["Active", "TeamWork 状态为 Active"],
            ["Striking Off", "处于 Strike Off 流程"],
            ["Terminated", "服务已终止"],
            ["Active ND", "当前有有效 Nominee Director 任职"],
            ["Address Service", "注册地址为 TASSURE 地址且客户有效"],
            ["ND Ceased", "曾有 ND，但当前已没有在任覆盖"],
        ], widths=[46, 119],
    ))
    s.append(heading("5.3 列表读取", 2))
    s.extend(bullets([
        "Status 以状态胶囊显示 Active、Striking Off、Terminated 或 Pending Sync。",
        "Nominee Director 与 Address Service 有资料时显示绿色胶囊；无资料时显示灰色。",
        "Contact 优先显示主要联系人；资料不足时可能显示 Email。",
        "如 UEN、状态或 ND 与 TeamWork 不一致，应记录公司名称并回到源系统核对。",
    ]))

    # 6 master list
    s.append(heading("6. Master List", 1))
    s.append(figure("master", "Master List 的统计卡、搜索、Add Manual 与可编辑表格"))
    s.append(heading("6.1 共通操作", 2))
    s.extend(bullets([
        "点击 Total Records、FYE Mismatch、Has Nominee Dir、MAS Regulated 或 Non-TeamWork 过滤。",
        "在搜索框输入公司名称或 ROC No.。",
        "点击单元格直接修改；保存后会显示短暂绿色勾。",
        "Add Manual 只用于没有自动资料来源的特殊记录，至少必须填写 Company Name。",
        "行尾 Actions 可移动到其他名单或删除；移动和删除均应先确认业务原因。",
    ]))
    s.append(heading("6.2 Active Client", 2))
    s.append(para("Active Client 是当前主要客户名单。页面使用精简列组，包含 Company、UEN、Active / Status、内部代码、Join Date、地址、联系资料、Nominee Director、Secretary、Annual Return、FYE、最近 AR / AGM / Accounts 日期、Next AGM Due、风险、MAS 与 Grade 等。"))
    s.append(callout("FYE Mismatch", "当人工 FYE 与 TeamWork FYE 月份不一致时，系统显示 FYE mismatch。点击该 FYE 单元格编辑人工值，但在保存前必须先确认 TeamWork 记录是否才是正确来源。", "warning"))
    s.append(heading("6.3 Ad-Hoc", 2))
    s.append(para("Ad-Hoc 记录非标准或单次服务客户，重点字段包括 Sec Agent、KYC Year、ROC、Corporate Tax、E-filing Authorization、Accounts、Audit、GST、Compilation Report、CPF、地址、联系资料、风险与 ACRA Update。"))
    s.append(figure("ad_hoc", "Ad-Hoc 客户名单与专用服务字段"))
    s.append(heading("6.4 MAS", 2))
    s.append(para("MAS 页面使用较少的专用列：Company Name、ROC No.、FYE、Last Accounts Date、Next AGM Due 与 MAS。用于快速检查受监管客户的到期与账户资料。"))
    s.append(figure("mas", "MAS 客户名单与监管字段"))
    s.append(heading("6.5 Strike Off / Terminated Services", 2))
    s.extend(bullets([
        "Strike Off 记录处于注销流程的公司；Terminated Services 记录已终止服务的公司。",
        "行尾 Actions 可 Move to Active Client；仅在确认恢复服务后执行。",
        "移动操作会改变名单类别与指定状态，不等同于在 TeamWork 完成全部状态更新。",
        "删除是不可逆的名单操作，应避免把删除当作归档。",
    ]))
    s.append(figure("strike_off", "Strike Off 名单、状态与操作栏"))
    s.append(figure("terminated", "Terminated Services 名单、状态与操作栏"))
    s.append(heading("6.6 Change Co Name", 2))
    s.append(para("Change Co Name 用于跟踪公司更名事项。操作方式与其他 Master List 相同，可搜索、编辑、Add Manual、分页和删除。建议在 Remark 中保留旧名称、正式更名日期与文件状态。"))
    s.append(figure("name_change", "Change Co Name 名单与更名资料"))

    # 7 billing system
    s.append(heading("7. Billing System", 1))
    s.append(para("Billing System 由 Nominee Directors、Address Service、AR Reminder、Late Filing 与 Billing Drafts 组成。AR Reminder 和 Billing Drafts 共享 FYE 月份与年份概念，开单名单以已生成并经员工审核的 AR 批次为主。"))

    s.append(heading("7.1 Nominee Directors", 2))
    s.append(figure("nd", "ND 复核区与在任目录"))
    s.append(heading("7.1.1 汇总与目录", 3))
    s.extend(bullets([
        "Total NDs：系统内配置的 ND 人员总数。",
        "Active NDs：目前至少有一个有效任职的 ND 人数。",
        "Total Active Appointments：全部有效在任公司数量。",
        "点击人员行可展开公司名单；搜索公司名称会自动展开并只显示匹配的在任记录。",
    ]))
    s.append(heading("7.1.2 TeamWork subrole review", 3))
    s.append(para("复核区只显示同时满足以下三个条件的记录：Nominee Director subrole 空白、有 Effective 就任日期、离任日期空白。它们不会自动算作有效 ND，而是要求人员回 TeamWork 判断与修正。LI JIANWEI 与 ZHANG DAN 已排除在该提醒队列外，但其正式有效任职仍正常同步。"))
    s.extend(numbered([
        "按公司名称或 ND 姓名搜索，或在下拉框按 ND 人员筛选。",
        "在 TeamWork 打开对应公司与人员关系。",
        "若确为 Nominee Director，补上正确 subrole；若不是，修正任职或离任资料。",
        "等待次日 08:00 ND 同步；修正后的提醒会自动消失。",
    ]))
    s.append(callout("不要直接忽略", "只有三个条件同时成立才进入复核区。若记录出现，表示系统无法安全判断是否属于有效 ND，必须由人员在 TeamWork 确认。", "danger"))

    s.append(heading("7.2 Address Service", 2))
    s.append(figure("address", "注册地址服务汇总与名单"))
    s.extend(bullets([
        "Total Address Service Clients 显示当前使用注册地址服务且 Active 的公司数。",
        "By Company Type 显示主要公司类型分布。",
        "Registered Address 显示系统使用的 TASSURE 地址。",
        "表格列为 Company Name、UEN、Type、Contact、PIC；每页最多 100 条。",
        "该页面来自 companies.uses_address 的实时视图；TeamWork 更新后需等每日公司同步。",
    ]))

    s.append(heading("7.3 AR Reminder", 2))
    s.append(para("AR Reminder 是系统的核心工作页面。它按 FYE 月份和年份形成一批公司，支持 List View 进行快速总览，也支持 Table View 直接更新大量工作流字段。"))
    s.append(figure("ar_list", "AR Reminder List View、服务胶囊与 Due Date"))
    s.append(heading("7.3.1 选择 FYE 批次", 3))
    s.extend(numbered([
        "在右上方选择月份与年份。",
        "系统读取该 FYE 批次，并显示 Total Companies、AR Filed、In Progress、Not Started 与 Overdue。",
        "点击统计卡过滤；输入公司名称进一步搜索。",
        "桌面版可在 List 与 Table 之间切换；移动版只提供较安全的查看卡片。",
    ]))
    s.append(heading("7.3.2 List View", 3))
    s.append(data_table(
        ["区域", "说明"],
        [
            ["Company Name / FYE", "公司名称及完整 FYE 日期"],
            ["UEN", "公司注册号码"],
            ["Services", "只显示启用服务；缩写包括 AR、AGM、SEC、ND、ADDR、XBRL、ACC、TAX"],
            ["Due Date", "Filed、剩余天数或逾期状态，以状态胶囊显示"],
            ["PIC", "主要 SEC PIC"],
            ["左侧色条", "绿色=AR Filed；琥珀=In Progress；灰色=Not Started"],
        ], widths=[44, 121],
    ))
    s.append(heading("7.3.3 服务状态", 3))
    s.append(data_table(
        ["状态", "外观", "含义"],
        [
            ["AUTO ON", "服务颜色或蓝色来源提示", "系统从 TeamWork / QB 自动判断为启用"],
            ["MANUAL ON", "绿色圆点 / 绿色边框", "员工明确强制开启"],
            ["AUTO OFF", "灰色", "系统未发现服务"],
            ["MANUAL OFF", "灰色并有人工状态", "员工明确关闭，自动化不会覆盖该值"],
            ["LOCKED", "不可点击", "系统管理项目，例如 Annual Return、AGM、ND、Address"],
        ], widths=[34, 46, 85],
    ))
    s.append(heading("7.3.4 Table View 与字段", 3))
    s.append(figure("ar_table", "固定表头、固定身份列与可编辑日期单元格"))
    s.append(data_table(
        ["列", "操作与定义"],
        [
            ["# / Company / UEN", "身份列；横向滚动时固定"],
            ["Reminder", "已发提醒日期"],
            ["Report Ready", "报告或文件准备完成日期"],
            ["AGM", "计划或记录的 AGM 日期"],
            ["To Client", "文件发给客户日期"],
            ["Signed", "已签收或收到签署文件日期"],
            ["AR", "Annual Return filed 日期"],
            ["XBRL", "Date、NO、FULL 或自定义值"],
            ["TW Update", "TeamWork 更新日期"],
            ["DPO", "YES、INFORM、DONE、CLIENT 或自定义值"],
            ["ROND RONS", "DONE、FILED、ACRA DONE、SENT & FILED 或自定义值"],
            ["SEC / ACC / TAX PIC", "可单独折叠；SEC 默认展开，ACC / TAX 默认收起"],
            ["Remarks", "自由备注"],
            ["Invoice / Email Sent", "财务列；发票资料与电邮发送日期"],
        ], widths=[42, 123], font_size=7.0,
    ))
    s.append(callout("日期清空", "清空日期后，等待保存状态完成再继续操作。不要连续快速输入、删除和切换多个单元格，以免产生不必要的并发请求。", "warning"))
    s.append(heading("7.3.5 公司详情弹窗", 3))
    s.append(figure("ar_modal", "Service configuration、History 与详细资料"))
    s.extend(bullets([
        "在 List View 点击整行打开弹窗；按 Esc、点 X 或点遮罩关闭。",
        "标题区显示公司、UEN、FYE、Due Date 与服务配置。",
        "Secretary、Accounts、Tax Filing、XBRL 可点击切换人工覆盖；再点一次恢复 Auto。",
        "ND 与 Address 跟随 TeamWork，不允许在此人工覆盖。",
        "Progress 区可编辑 Reminder、Report Ready、To Client、Signed、AGM Date、AR Filed。",
        "Team 区可编辑 SEC PIC、ACC PIC、TAX PIC。",
        "Service Periods 与 QB Invoices 为自动资料；用于核对服务期限、费用与历史发票。",
        "Finance 区记录 Invoice 与 Email Sent。",
    ]))
    s.append(heading("7.3.6 ND 特殊标记", 3))
    s.append(data_table(
        ["标记", "正确含义"],
        [
            ["Strike-Off Pending", "注销流程已开始但尚未由 ACRA 正式确认；所有服务仍保持有效并可开单"],
            ["ND Assignment Pending", "客户需要 ND 服务，但 TeamWork 尚未分配具体 ND 人员"],
        ], widths=[52, 113],
    ))
    s.append(heading("7.3.7 History 与还原", 3))
    s.append(figure("ar_history", "AR Reminder 变更历史与 Restore 区域"))
    s.extend(numbered([
        "点击弹窗右上角 History。",
        "查看字段、旧值、新值、修改人、修改时间与版本。",
        "如需还原，点击对应记录的 Restore。",
        "如果该字段后来又被其他人修改，系统会阻止不安全还原；应先核对最新值。",
    ]))
    s.append(heading("7.3.8 Add Manual 与删除", 3))
    s.extend(bullets([
        "Add Manual 用于补充未由自动批次产生的公司；填写 Company Name，并尽量补 UEN、PIC、Due Date。",
        "删除会移除该 AR Reminder 记录；只有确认记录错误或重复时才使用。",
        "业务已完成不等于应删除；应填 AR Filed、Invoice 或 Remarks 作为完成记录。",
    ]))

    s.append(heading("7.4 Late Filing", 2))
    s.append(figure("late", "Late Filing 风险卡、状态胶囊与处理动作"))
    s.append(heading("7.4.1 风险分类", 3))
    s.append(data_table(
        ["分类", "规则"],
        [
            ["Seriously Overdue", "逾期超过 365 天或处于 Strike Off"],
            ["Recently Overdue", "已逾期但不超过 365 天"],
            ["Habitual Risk", "历史平均延迟超过阈值，但当前周期可能尚未逾期"],
            ["Under Review", "自动风险已清除，等待人工核实"],
            ["Resolved", "人工已核实并完成处理；记录保留，不删除"],
        ], widths=[47, 118],
    ))
    s.append(heading("7.4.2 正确处理 Under Review", 3))
    s.extend(numbered([
        "点击 Under Review 卡筛选。",
        "在 TeamWork 与 ACRA 资料中确认风险是否已消失。",
        "若已解决，点击青色打勾。系统把 Review: 改为 Resolved: 并保留记录。",
        "若仍有问题，点击编辑，更新 Remarks 或日期。",
    ]))
    s.append(callout("删除规则", "自动识别的 Late Filing 记录不能删除。Manual 记录才可删除。对已处理风险应使用 Resolved，而不是删除，以保留审计轨迹。", "danger"))
    s.append(heading("7.4.3 Add Manual", 3))
    s.append(para("对无法由 TeamWork 自动识别的公司，可使用 Add Manual。填写 Company Name、UEN、FYE Month、Remarks，以及 Last AR、Last AGM、Last Accounts、Next AGM Due。保存后会与自动结果合并。"))

    s.append(heading("7.5 Billing Drafts", 2))
    s.append(para("Billing Drafts 以选定 FYE 的 AR Reminder 批次为开单主名单，再连接 QuickBooks 历史发票，以建议服务项目、描述、期间与费用。系统不会在未经人员审核的情况下自动创建发票。"))
    s.append(figure("billing_list", "Billing Draft 列表、状态与 TAB / TAC 发票栏"))
    s.append(heading("7.5.1 列表与状态", 3))
    s.append(data_table(
        ["列", "说明"],
        [
            ["Company", "公司名称与 UEN"],
            ["Billing Status", "To invoice 或 Invoiced"],
            ["FYE", "本次开单批次月份"],
            ["Renewal Services", "SEC 与 ADDR 服务状态"],
            ["ND TAC", "Nominee Director 状态；在 TAC 单独开票"],
            ["Annual Obligations", "AR 与 XBRL 状态"],
            ["TAB Invoice", "本周期系统生成的 TAB 发票号码"],
            ["TAC Invoice", "本周期 TAC 发票；如无本周期记录，可能显示淡色历史 ND 发票"],
            ["PIC", "公司主要 PIC"],
        ], widths=[43, 122],
    ))
    s.append(heading("7.5.2 建立开单草稿", 3))
    s.extend(numbered([
        "选择 Invoicing FYE 月份和年份。",
        "点击 Needs Billing 卡，或搜索公司名称。",
        "点击公司行打开 Build & Generate Invoice 弹窗。",
        "核对客户 Email 与 Invoice date。",
        "逐行检查 Use、Service、Description、Status、Qty、Rate 与 Amount。",
        "取消不应开票的行；需要额外项目时使用 Add line / Add ND line。",
        "核对 TAB / TAC 建议发票号码及警告。",
        "确认总额后再点击 Generate Invoice in QB。",
    ]))
    s.append(figure("invoice_builder", "TAB / TAC 分区、建议号码与 Generate 按钮"))
    s.append(heading("7.5.3 TAB 与 TAC 分单逻辑", 3))
    s.append(data_table(
        ["公司", "包含项目", "PIC / Location 规则"],
        [
            ["TAB", "Secretary、Address、AR、XBRL、Accounts、Tax、Discount 等", "只有 Secretary 与 XBRL 行使用公司 PIC；发票 Location 取当前登录 Email 对应的 TAB 姓名"],
            ["TAC", "Nominee Director 费用", "ND 人名以 TeamWork 最新有效任职为准，写入服务项目简写；Location 取当前登录 Email 对应的 TAC 姓名"],
        ], widths=[28, 69, 68], font_size=7.1,
    ))
    s.append(callout("ND 费用格式", "TAC ND 行应保留带 ND 简写的服务项目，并在描述中写明 Nominee Director for one year 及期间。系统会按历史发票把相关 ND 年费合计为一个开单行，但必须人工核对金额。", "info"))
    s.append(heading("7.5.4 QuickBooks 发票号码防冲突", 3))
    s.append(para("系统打开开单弹窗时会向 QuickBooks 读取建议号码。生成前会再次核对号码，并使用 QuickBooks 自动分配与系统幂等键防止重复创建。若期间有人在 QB 手工开了新单，系统会刷新号码并显示警告，不会沿用已经冲突的号码。"))
    s.extend(bullets([
        "建议号码可人工修改，但修改后会显示黄色提醒。",
        "若返回 number changed in QuickBooks，表示未创建发票；核对新号码后再点 Generate。",
        "不要连续双击 Generate；按钮在请求期间会变为 Generating。",
        "若网络中断且结果不确定，不要立即重开；先在 QB 搜索公司、日期和金额，再查看系统 Billing Status。",
    ]))
    s.append(heading("7.5.5 发票创建后的动作", 3))
    s.extend(numbered([
        "确认绿色结果显示 TAB / TAC 发票号码和金额。",
        "点击 Choose Folder & Save PDF。",
        "选择本地文件夹；系统从 QuickBooks 取得官方 Invoice PDF，并以 发票号 - 公司名称 - TAB/TAC.pdf 命名。",
        "若浏览器不支持直接选择文件夹，PDF 会以正常下载方式保存。",
        "在 QuickBooks 内再次检查草稿。系统不会自动发送给客户，最终 Review 与 Send 仍在 QB 完成。",
    ]))
    s.append(callout("已开单重新进入", "Billing Status 显示 Invoiced 后，重新打开该公司仍应看到本周期已保存的 QB Invoice ID 与 PDF 操作。若号码存在但 PDF 按钮缺失，先 Refresh；仍异常时记录公司、FYE、TAB/TAC 与发票号后交由管理员检查。", "success"))

    # 8 automation
    s.append(heading("8. 自动化与系统整合", 1))
    s.append(figure("automation", "每日自动任务与 QuickBooks Webhook"))
    s.append(heading("8.1 每日自动化时间", 2))
    s.append(data_table(
        ["新加坡时间", "任务", "主要结果"],
        [
            ["08:00", "TeamWork ND", "同步配置 ND 人员、有效任职，并更新缺少 subrole 的复核队列"],
            ["08:30", "TeamWork Companies", "同步公司主档、状态、UEN、FYE、PIC、注册地址等"],
            ["09:00", "AR Generate", "依据公司资料生成或更新 AR Reminder 批次"],
            ["09:30", "QuickBooks Full Sync", "同步发票与发票行，作为 Webhook 的完整对账后备"],
            ["10:00", "AR Workflow", "同步可自动判断的 AR 工作流资料"],
            ["11:00", "Late Filing", "扫描 TeamWork AGM / AR 历史，更新风险与 Review 队列"],
        ], widths=[30, 47, 88],
    ))
    s.append(heading("8.2 QuickBooks Webhook", 2))
    s.append(para("QuickBooks Webhook 是变更通知机制。当 TAB 或 TAC 的 Invoice 新增、更新或删除时，QuickBooks 会通知系统。系统验证签名后把事件写入耐久队列，再读取指定 Invoice ID 进行增量同步。每日 09:30 的完整同步仍保留，用于弥补延迟、遗漏或历史数据对账。"))
    s.append(data_table(
        ["状态", "含义", "处理"],
        [
            ["pending", "事件已接收，等待处理", "通常自动继续"],
            ["processing", "正在读取 QB 并更新数据库", "不要重复操作"],
            ["processed", "已完成", "无需处理"],
            ["failed", "处理失败并记录错误", "管理员按 last_error 排查，系统可重试"],
        ], widths=[30, 62, 73],
    ))
    s.append(heading("8.3 自动化不是完全实时", 2))
    s.extend(bullets([
        "QuickBooks Invoice 采用 Webhook 近实时更新，但仍可能有几秒到数分钟延迟。",
        "TeamWork 当前采用每日批次同步；在 TeamWork 修正后通常需等下一次计划任务。",
        "AR Reminder 员工编辑属于系统内实时保存，并通过 Realtime 通知其他已打开页面。",
        "不建议把所有 TeamWork 自动化改为持续实时抓取，这会增加源系统负载、页面卡顿与故障复杂度。",
    ]))

    # 9 data standards
    s.append(heading("9. 数据录入规范", 1))
    s.append(heading("9.1 日期", 2))
    s.extend(bullets([
        "显示统一为 DD MMM YYYY，例如 03 Apr 2026。",
        "不要在日期字段输入状态词、姓名或备注；状态词应放在 Remarks 或专用下拉字段。",
        "日期不确定时留空并在 Remarks 说明，不要填写估算日期。",
        "删除日期代表明确清空，应先确认不是误操作。",
    ]))
    s.append(heading("9.2 公司名称与 UEN", 2))
    s.extend(bullets([
        "公司名称应尽量与 TeamWork / ACRA 正式名称一致，包括 PTE. LTD. 与标点。",
        "UEN 不应放空格、姓名、内部 ID 或发票号码。",
        "更名公司应在 Change Co Name 保留旧名称与新名称，避免历史 QB 发票匹配失败。",
        "发现多个近似公司时不要直接合并或删除，先按 UEN 和 TeamWork Company ID 核对。",
    ]))
    s.append(heading("9.3 PIC 与人员名称", 2))
    s.extend(bullets([
        "PIC 必须显示人员姓名，不得显示 TeamWork 数字 User ID。",
        "如出现 9、10、11、12 等纯数字，应在 TeamWork 人员映射中修正，不要只改当前一行。",
        "开单 Location 由登录 Email 映射到 QB 现有 Location；系统不会为新员工自动创建 QB Location。",
    ]))
    s.append(heading("9.4 Manual 与 Auto 的边界", 2))
    s.append(data_table(
        ["情况", "建议"],
        [
            ["源系统缺少资料", "回 TeamWork / QB 修正；必要时暂时在 Remarks 说明"],
            ["业务确认与系统自动判断不同", "使用允许的 Manual Override，并写明原因"],
            ["特殊公司不在自动名单", "使用 Add Manual，确保 UEN 与公司名称准确"],
            ["风险已处理", "使用 Resolved 或完成日期，不要删除记录"],
        ], widths=[50, 115],
    ))

    # 10 collaboration
    s.append(heading("10. 多人同时操作与冲突处理", 1))
    s.append(para("系统允许多个已批准账户同时登录。AR Reminder 使用版本号、更新时间、修改人和 Realtime 机制降低相互覆盖风险。仍应避免多人同时编辑同一家公司同一字段。"))
    s.append(heading("10.1 冲突提示", 2))
    s.append(data_table(
        ["按钮", "含义", "何时使用"],
        [
            ["Use latest", "接受数据库中的最新值，放弃本次输入", "另一位同事的更新较新或你无法确认时"],
            ["Keep mine", "以你的输入覆盖当前最新值", "已与同事确认，且你的值才是正确最终值时"],
        ], widths=[32, 59, 74],
    ))
    s.append(heading("10.2 推荐协作方式", 2))
    s.extend(bullets([
        "按公司或 FYE 批次分工，避免同一时段编辑同一行。",
        "开单前在团队沟通渠道确认由谁负责该公司，避免系统和 QB 两边同时操作。",
        "出现 Changed by ... 时先停下，不要习惯性点 Keep mine。",
        "重要字段改动后可在 History 确认修改人和时间。",
        "若页面出现实时更新提示，先阅读受影响公司，再继续输入。",
    ]))
    s.append(callout("禁止事项", "不要同时在两个浏览器标签编辑同一公司；不要在 Generate 发票期间刷新页面；不要多人共用同一个 Google 账户。", "danger"))

    # 11 security
    s.append(heading("11. 安全、权限与审计", 1))
    s.append(heading("11.1 当前权限模型", 2))
    s.append(para("当前阶段采用 Google Email 批准名单。不同账户会显示各自规范姓名，并用于 AR 变更记录与 QuickBooks Location 映射。业务页面权限目前大致相同，后续可再按岗位增加细分权限。"))
    s.append(heading("11.2 用户责任", 2))
    s.extend(bullets([
        "仅使用自己的公司 Google 账户。",
        "不得分享登录链接、Session、QuickBooks 授权或导出的客户资料。",
        "不要把 Supabase、Google OAuth、QuickBooks Client Secret 或 Vercel 环境变量复制到聊天、邮件或手册。",
        "离职、转岗或不再需要系统时，应及时从批准名单与相关 OAuth 权限中移除。",
        "若怀疑账户被盗用，应立即 Logout、修改 Google 密码并通知管理员撤销 Session。",
    ]))
    s.append(heading("11.3 审计能力", 2))
    s.extend(bullets([
        "AR Reminder 保存 updated_at、updated_by_email、updated_by_name 与 version。",
        "每次字段变化会写入 AR audit history，包含旧值、新值、修改人和时间。",
        "系统生成发票记录保存 created_by_email 与 idempotency_key。",
        "QuickBooks Webhook 事件保存 event_id、realm_id、entity_id、operation、处理状态与错误。",
    ]))

    # 12 troubleshooting
    s.append(heading("12. 常见问题与排查", 1))
    s.append(data_table(
        ["现象", "先检查", "处理"],
        [
            ["无法登录", "是否使用批准的 Google Email；是否完成 Google 授权", "退出错误账户后重试；仍失败时提供 Email 与错误画面给管理员"],
            ["页面一直 Loading", "网络、Session、Automation health", "刷新一次；重新登录；不要连续多次点击 Refresh"],
            ["日期保存失败", "格式是否为 03 Apr 2026 或有效日期", "修正格式；点 Retry；必要时 Revert"],
            ["AR 显示冲突", "Changed by 的姓名与最新值", "优先 Use latest；确认后才 Keep mine"],
            ["PIC 显示数字", "TeamWork User ID 映射", "记录公司与数字，回 TeamWork / 映射表修正"],
            ["ND Review 出现公司", "是否同时满足三项条件", "在 TeamWork 补 subrole 或修正任职/离任日期"],
            ["QB 状态红色", "TAB / TAC 哪一家公司失效", "点击 Verify / Reconnect；授权需对应 QB 管理员"],
            ["发票号码改变", "是否有人刚在 QB 开单", "接受刷新后的号码，重新核对再 Generate"],
            ["Generate 后结果不确定", "QB 是否已有同公司、日期、金额发票", "先查 QB，避免重复生成；再查 Billing Status"],
            ["PDF 不能选文件夹", "浏览器是否支持目录选择", "允许浏览器权限，或使用自动下载后手工移动"],
            ["Late Filing 无法删除", "记录是否为 auto", "自动记录不能删；在 TeamWork 修正或使用 Resolved"],
            ["Automation exceptions 增加", "异常分组和详细记录", "按来源修正，不要因数量增加直接删除资料"],
        ], widths=[45, 55, 65], font_size=6.8,
    ))
    s.append(Spacer(1, 5 * mm))
    s.append(callout("向管理员报告时", "请提供：页面名称、公司名称、FYE 月份/年份、操作时间、登录 Email、错误文字、是否已重试。涉及发票时再提供 TAB/TAC、发票号与 QB Invoice ID（如画面可见）。不要发送密码或 Secret。", "info"))

    # 13 SOP
    s.append(heading("13. 推荐操作清单", 1))
    s.append(heading("13.1 每日开始", 2))
    s.extend(bullets([
        "登录后确认右上角姓名与 Email 正确。",
        "查看 Dashboard 的 TAB / TAC 连接状态。",
        "展开 Automation health，确认没有 failed 或 stale 任务。",
        "检查当天负责的 AR 批次、Late Filing Under Review 与 Needs Billing。",
    ]))
    s.append(heading("13.2 AR 日常处理", 2))
    s.extend(bullets([
        "选择正确 FYE 月份与年份。",
        "优先处理 Overdue，再处理 In Progress。",
        "录入日期后观察保存状态；重要变化到 History 核对。",
        "检查服务配置，Manual Override 必须有业务依据。",
        "完成后确认 AR Filed、Invoice 与 Email Sent 等关键字段。",
    ]))
    s.append(heading("13.3 开单前检查", 2))
    s.extend(bullets([
        "公司与 UEN 正确；FYE 批次正确。",
        "TAB / TAC QuickBooks 连接为绿色。",
        "服务项目、描述、期间、数量、费率、折扣均已核对。",
        "ND 人员与 TAC 服务简写以 TeamWork 最新有效任职为准。",
        "发票日期、Email、PIC 与登录用户 Location 正确。",
        "建议号码无冲突警告；总额正确。",
    ]))
    s.append(heading("13.4 每周复核", 2))
    s.extend(bullets([
        "清理 ND subrole review，回 TeamWork 修正。",
        "处理 Late Filing Under Review，并转为 Resolved 或更新原因。",
        "检查 Dashboard integration exceptions 的新增项目。",
        "抽查已开单公司是否同时显示 Billing Status、TAB/TAC Invoice 与 PDF 操作。",
        "导出 Company Data 作为业务复核，不把导出文件当作新的主数据源。",
    ]))

    # 14 glossary
    s.append(heading("14. 术语与字段速查", 1))
    s.append(data_table(
        ["术语", "中文说明"],
        [
            ["AR", "Annual Return，年度申报"],
            ["AGM", "Annual General Meeting，股东周年大会"],
            ["FYE", "Financial Year End，财政年度结束日"],
            ["UEN / ROC No.", "公司注册号码"],
            ["PIC", "Person in Charge，负责人"],
            ["SEC", "Secretary，公司秘书服务"],
            ["ADDR", "Registered Address，注册地址服务"],
            ["ND", "Nominee Director，名义董事"],
            ["XBRL", "结构化财务报告申报"],
            ["DPO", "系统中的 Data Protection Officer 处理状态字段"],
            ["ROND / RONS", "Register of Nominee Directors / Shareholders 相关状态"],
            ["TAB", "TASSURE ASIA BIZSERVICES - 基本服务开票公司"],
            ["TAC", "Nominee Director 相关费用的独立开票公司"],
            ["AUTO", "系统根据源资料自动判断"],
            ["MANUAL", "员工明确覆盖自动判断"],
            ["Webhook", "QuickBooks 主动通知系统资料发生变化的机制"],
            ["Idempotency", "同一开单请求即使重试，也不会重复创建发票的控制机制"],
        ], widths=[48, 117],
    ))
    s.append(heading("14.1 快速求助路径", 2))
    s.append(data_table(
        ["问题类别", "首要处理者"],
        [
            ["TeamWork 公司、FYE、PIC、ND、Address 错误", "负责 TeamWork 主档的运营人员"],
            ["QuickBooks 客户、项目、费率、发票、连接", "Billing / Finance 或 QB 管理员"],
            ["AR 日期冲突、History、页面保存失败", "系统管理员 / 技术支持"],
            ["Google 登录批准名单与权限", "系统管理员"],
            ["Late Filing 业务判断", "Corporate Secretarial 负责人"],
        ], widths=[86, 79],
    ))
    s.append(Spacer(1, 8 * mm))
    s.append(callout("完成", "本手册以正确数据来源、可追溯修改、先审核后开单为核心。遇到不确定事项时，先保留记录、核对来源，再进行更改。", "success"))
    s.append(Spacer(1, 4 * mm))
    s.append(Paragraph("- End of Manual -", ParagraphStyle("end", parent=STYLES["Small"], alignment=TA_CENTER, textColor=MUTED)))

    return s


def main():
    doc = create_doc()
    story = build_story()
    doc.multiBuild(story)
    print(OUTPUT_FILE)


if __name__ == "__main__":
    main()

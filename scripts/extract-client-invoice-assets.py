"""Builds templates/client-invoice/*.png from real QuickBooks invoice PDFs.

The system draws the invoice PDF clients receive itself (lib/client-invoice-*,
docs/INVARIANTS.md INV-QB-029) so each service shows once at its full amount.
Only the parts that never change per invoice come from QuickBooks' own PDF,
as PIXELS — the letterhead (with the Chinese company name), the service
banner at the foot of the page, and the PayNow QR (identical across invoices
of one book, checked 2026-10-05: so it carries no amount). Cropping pixels,
not copying PDF content, means no text from the sample invoice (another
client's lines or amounts) can ride along hidden in the file.

Usage (any one real invoice PDF per book, downloaded from QuickBooks):
  python scripts/extract-client-invoice-assets.py TAB path/to/tab-invoice.pdf
  python scripts/extract-client-invoice-assets.py TAC path/to/tac-invoice.pdf
Needs PyMuPDF (`pip install pymupdf`). Re-run only if the QuickBooks invoice
template itself changes.
"""
import os
import sys

import fitz  # PyMuPDF

DPI = 300
HEADER = fitz.Rect(0, 15, 612, 130)   # company name, Chinese name, registration, address, tel, website, logo
FOOTER = fitz.Rect(0, 742, 612, 772)  # rule + "Accounting / 会计服务 …" banner


def main(book: str, pdf_path: str) -> None:
    book = book.upper()
    if book not in ('TAB', 'TAC'):
        sys.exit('book must be TAB or TAC')
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'templates', 'client-invoice')
    os.makedirs(out_dir, exist_ok=True)
    doc = fitz.open(pdf_path)
    first = doc[0]
    if abs(first.rect.width - 612) > 1 or abs(first.rect.height - 792) > 1:
        sys.exit(f'unexpected page size {first.rect} — the template changed, check the crops by hand')
    first.get_pixmap(dpi=DPI, clip=HEADER).save(os.path.join(out_dir, f'{book.lower()}-header.png'))
    first.get_pixmap(dpi=DPI, clip=FOOTER).save(os.path.join(out_dir, f'{book.lower()}-footer.png'))
    # The QR is the only image besides the logo; take the squarer, smaller one.
    candidates = []
    for page in doc:
        for info in page.get_image_info(xrefs=True):
            w, h = info['width'], info['height']
            if info['xref'] and abs(w - h) <= 12:
                candidates.append((w * h, info['xref']))
    if not candidates:
        sys.exit('no PayNow QR image found')
    xref = min(candidates)[1]
    pix = fitz.Pixmap(doc, xref)
    if pix.alpha or pix.n > 3:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    pix.save(os.path.join(out_dir, f'{book.lower()}-qr.png'))
    print(f'{book}: header, footer and qr written to {os.path.normpath(out_dir)}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])

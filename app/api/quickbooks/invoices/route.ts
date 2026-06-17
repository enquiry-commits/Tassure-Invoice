import { NextRequest, NextResponse } from 'next/server';
import { qbQuery } from '@/lib/quickbooks';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get('year') ?? new Date().getFullYear().toString();

  const result = await qbQuery(
    `SELECT * FROM Invoice WHERE TxnDate >= '${year}-01-01' AND TxnDate <= '${year}-12-31' MAXRESULTS 1000`
  );

  if (!result) {
    return NextResponse.json({ error: 'QuickBooks not connected or token expired' }, { status: 401 });
  }

  const invoices = result.rows.map((inv: Record<string, unknown>) => {
    const lines = (inv.Line as Record<string, unknown>[] ?? [])
      .filter((l: Record<string, unknown>) => l.DetailType === 'SalesItemLineDetail')
      .map((l: Record<string, unknown>) => {
        const detail = l.SalesItemLineDetail as Record<string, unknown> ?? {};
        const item   = detail.ItemRef as Record<string, unknown> ?? {};
        return {
          description: l.Description ?? item.name ?? '',
          qty:  detail.Qty ?? 1,
          rate: detail.UnitPrice ?? 0,
          amount: l.Amount ?? 0,
        };
      });

    const customer = inv.CustomerRef as Record<string, unknown> ?? {};

    return {
      id:           inv.Id,
      docNumber:    inv.DocNumber,
      txnDate:      inv.TxnDate,
      dueDate:      inv.DueDate,
      customerName: customer.name ?? '',
      customerId:   customer.value ?? '',
      totalAmt:     inv.TotalAmt ?? 0,
      balance:      inv.Balance ?? 0,
      status:       (inv.Balance as number) === 0 ? 'Paid' : 'Open',
      emailStatus:  inv.EmailStatus ?? '',
      lines,
    };
  });

  // Sort newest first
  invoices.sort((a, b) => (b.txnDate as string).localeCompare(a.txnDate as string));

  return NextResponse.json({
    year,
    total: invoices.length,
    invoices,
  });
}

import { getSettings } from "@/lib/services/settings";
import { getSharedBill } from "@/lib/services/billing";
import { renderBillPdf } from "@/lib/bill-pdf";

/** The PDF behind "Download PDF" on the customer's bill page; same secret code, same expiry. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [settings, bill] = await Promise.all([getSettings(), getSharedBill(token)]);
  if (!bill) return new Response("This bill link has expired. Please contact the salon.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const pdf = await renderBillPdf(bill, settings.businessName, settings.currencySymbol);
  const shop = settings.businessName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "Bill";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${shop}-${bill.billNumber}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}

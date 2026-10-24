import type { Metadata } from "next";
import { Download, ShoppingBag } from "lucide-react";
import { getSettings } from "@/lib/services/settings";
import { getSharedBill } from "@/lib/services/billing";
import { SHOP_ONLINE_URL, SHOP_PHONE } from "@/lib/constants";
import { BillReceipt } from "@/components/app/bill-receipt";
import { Button } from "@/components/ui/button";

/**
 * The bill a customer opens from the WhatsApp message. No login: the secret code in
 * the address is the key, and it stops working after SHARE_LINK_DAYS. Kept out of
 * search engines and never says whether a wrong code belongs to a real bill.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: { absolute: `Your bill · ${settings.businessName}` },
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function SharedBillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [settings, bill] = await Promise.all([getSettings(), getSharedBill(token)]);

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-5 px-4 py-8">
      {bill ? (
        <>
          <BillReceipt bill={bill} businessName={settings.businessName} currencySymbol={settings.currencySymbol} />
          <div className="flex flex-col gap-2 print:hidden">
            <Button size="lg" className="h-12" render={<a href={`/b/${encodeURIComponent(token)}/pdf`} download />}>
              <Download /> Download PDF
            </Button>
            <Button size="lg" variant="outline" className="h-12" render={<a href={SHOP_ONLINE_URL} target="_blank" rel="noreferrer" />}>
              <ShoppingBag /> Shop our products online
            </Button>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border bg-card p-6 text-center shadow-xs">
          <h1 className="font-heading text-xl font-semibold">{settings.businessName}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This bill link has expired. Please call the salon on{" "}
            <a href={`tel:${SHOP_PHONE}`} className="font-medium text-foreground underline underline-offset-2">
              {SHOP_PHONE}
            </a>{" "}
            for a copy of your bill.
          </p>
          <Button size="lg" variant="outline" className="mt-5 h-12 w-full" render={<a href={SHOP_ONLINE_URL} target="_blank" rel="noreferrer" />}>
            <ShoppingBag /> Shop our products online
          </Button>
        </div>
      )}
    </main>
  );
}

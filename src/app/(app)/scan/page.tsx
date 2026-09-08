import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { PageHeader } from "@/components/app/page-header";
import { BarcodeScanner } from "@/components/app/barcode-scanner";

export const metadata: Metadata = { title: "Scan Barcode" };

export default async function ScanPage() {
  await requireUserPage();
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Scan Barcode" description="Use the phone camera, or a USB scanner plugged into a computer." />
      <BarcodeScanner />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getProduct, listCategories, productForViewer } from "@/lib/services/products";
import { PageHeader } from "@/components/app/page-header";
import { ProductForm } from "@/components/app/product-form";

export const metadata: Metadata = { title: "Edit Product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionPage("product.edit");
  const { id } = await params;
  const [settings, categories, found] = await Promise.all([getSettings(), listCategories(), getProduct(id)]);
  if (!found) notFound();
  const product = productForViewer(found, user.role);
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/inventory/${id}`} className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to {product.name}
      </Link>
      <PageHeader
        title="Edit Product"
        description={
          user.role === "OWNER"
            ? "Stock quantity is changed through Sell, Add Stock or Adjust so every change is recorded."
            : "Managers can edit basic product information. Prices are set by the owner; quantity is changed through Sell, Add Stock or Adjust."
        }
      />
      <ProductForm
        categories={categories}
        currencySymbol={settings.currencySymbol}
        product={product}
        isOwner={user.role === "OWNER"}
        globalThreshold={settings.lowStockThreshold}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { listCategories } from "@/lib/services/products";
import { PageHeader } from "@/components/app/page-header";
import { ProductForm } from "@/components/app/product-form";

export const metadata: Metadata = { title: "Add Product" };

export default async function NewProductPage() {
  const user = await requirePermissionPage("product.create");
  const [settings, categories] = await Promise.all([getSettings(), listCategories()]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add Product" description="Create a new item. It appears in inventory immediately after saving." />
      <ProductForm categories={categories} currencySymbol={settings.currencySymbol} isOwner={user.role === "OWNER"} globalThreshold={settings.lowStockThreshold} />
    </div>
  );
}

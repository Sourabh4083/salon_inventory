import { cache } from "react";
import { prisma } from "@/lib/db";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/lib/stock-status";

export type BusinessSettingsData = {
  businessName: string;
  currencyCode: string;
  currencySymbol: string;
  lowStockThreshold: number;
};

const DEFAULTS: BusinessSettingsData = {
  businessName: "Salon & Hair Studio",
  currencyCode: "INR",
  currencySymbol: "₹",
  lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
};

/**
 * Returns the single settings row, creating it with defaults on first use.
 * Deduplicated per request: the layout, page and services all read it.
 */
export const getSettings = cache(async (): Promise<BusinessSettingsData> => {
  const row =
    (await prisma.businessSettings.findUnique({ where: { id: "default" } })) ??
    (await prisma.businessSettings.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default", ...DEFAULTS },
    }));
  return {
    businessName: row.businessName,
    currencyCode: row.currencyCode,
    currencySymbol: row.currencySymbol,
    lowStockThreshold: row.lowStockThreshold,
  };
});

export async function updateSettings(data: BusinessSettingsData, actorId: string) {
  const before = await getSettings();
  const row = await prisma.businessSettings.update({ where: { id: "default" }, data });
  await prisma.auditLog.create({
    data: {
      action: "SETTINGS_UPDATED",
      entityType: "BusinessSettings",
      entityId: "default",
      summary: `Business settings updated (low stock threshold ${before.lowStockThreshold} → ${row.lowStockThreshold})`,
      metadata: { before, after: data },
      actorId,
    },
  });
  return row;
}

/** The shop's owners (partners), or an empty list until they are typed in Settings. */
export async function getOwnerNames(): Promise<string[]> {
  await getSettings(); // makes sure the settings row exists
  const row = await prisma.businessSettings.findUnique({ where: { id: "default" }, select: { ownerNames: true } });
  return row?.ownerNames ?? [];
}

export async function setOwnerNames(names: string[], actorId: string) {
  const before = await getOwnerNames();
  await prisma.businessSettings.update({ where: { id: "default" }, data: { ownerNames: names } });
  await prisma.auditLog.create({
    data: {
      action: "SETTINGS_UPDATED",
      entityType: "BusinessSettings",
      entityId: "default",
      summary: `Owners set to ${names.length ? names.join(" and ") : "none"}`,
      metadata: { before, after: names },
      actorId,
    },
  });
}

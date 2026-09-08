/**
 * Seeds demo accounts, categories, business settings and the shop's current inventory.
 *
 * Inventory source (first that applies):
 *   1. data/Hair accesories.xlsx  (columns: S. No. | Products | Price | Available Stock)
 *   2. The built-in list below (same products, used when the spreadsheet is missing)
 *
 * Safe to re-run: products are matched by name (case-insensitive) and never duplicated.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "Owner@Salon2026!";
const MANAGER_PASSWORD = process.env.SEED_MANAGER_PASSWORD ?? "Manager@Salon2026!";

const CATEGORIES = [
  "Hair System",
  "Wig",
  "Topper",
  "Hair Extension",
  "Adhesive",
  "Glue",
  "Tape",
  "Solvent / Remover",
  "Softener",
  "Scalp Care",
  "Hair Accessory",
  "Tool",
  "Other",
];

type SeedProduct = { name: string; price: number | null; quantity: number; category: string; unit?: string };

/** Built-in inventory (mirrors the shop spreadsheet). */
const FALLBACK_PRODUCTS: SeedProduct[] = [
  { name: "Hair Extension Iron 100F", price: 800, quantity: 1, category: "Tool" },
  { name: "Italian Glue", price: 600, quantity: 2, category: "Glue" },
  { name: "Lacehold", price: 1000, quantity: 2, category: "Adhesive" },
  { name: "Ultrahold", price: 2100, quantity: 1, category: "Adhesive" },
  { name: "Scalp Protector", price: 250, quantity: 2, category: "Scalp Care" },
  { name: "C-22 Gallon", price: 3500, quantity: 1, category: "Solvent / Remover" },
  { name: "Softener", price: 3500, quantity: 1, category: "Softener" },
  { name: "Yellow Tape Local", price: 120, quantity: 0, category: "Tape" },
  { name: "Johnson White", price: 190, quantity: 2, category: "Tape" },
  { name: "Johnson Yellow 20 Yard", price: 180, quantity: 4, category: "Tape" },
  { name: "D-Divine White 22 Yard", price: 450, quantity: 3, category: "Tape" },
  { name: "D-Divine Red", price: 350, quantity: 3, category: "Tape" },
  { name: "Johnson Red", price: 450, quantity: 2, category: "Tape" },
  { name: "Johnson Premium", price: 1200, quantity: 2, category: "Tape" },
  { name: "Blue 36 Yard", price: 2100, quantity: 1, category: "Tape" },
  { name: "Small Softener C-1", price: 120, quantity: 12, category: "Softener" },
  { name: "C-22 D-Divine", price: 120, quantity: 0, category: "Solvent / Remover" },
  { name: "Divine 7 Yard White", price: 120, quantity: 4, category: "Tape" },
  { name: "5 Meter Yellow Tape", price: 70, quantity: 7, category: "Tape" },
  { name: "Cut Piece", price: 150, quantity: 1, category: "Hair Accessory" },
  { name: "Black Cotton 5 Meter", price: 120, quantity: 10, category: "Hair Accessory" },
  { name: "Super Glue", price: 250, quantity: 0, category: "Glue" },
  { name: "Tic Tac", price: null, quantity: 0, category: "Hair Accessory" },
];

/** Hair system / topper / extension items the shop purchases. */
const HAIR_PRODUCTS: SeedProduct[] = [
  { name: "4x4 Topper - 16 inch", price: 9500, quantity: 2, category: "Topper" },
  { name: "4x4 Topper - 24 inch", price: 12500, quantity: 1, category: "Topper" },
  { name: "5x5 Topper - 16 inch", price: 11000, quantity: 3, category: "Topper" },
  { name: "5x5 Topper - 24 inch", price: 14500, quantity: 0, category: "Topper" },
  { name: "Single Drawn - 24 inch", price: 6500, quantity: 6, category: "Hair Extension" },
  { name: "Standard Double Drawn - 30 inch", price: 9800, quantity: 5, category: "Hair Extension" },
  { name: "High Double Drawn - 24 inch", price: 12000, quantity: 4, category: "Hair Extension" },
  { name: "High Double Drawn - 36 inch", price: 16500, quantity: 1, category: "Hair Extension" },
  { name: "Full Lace Hair System", price: 18000, quantity: 2, category: "Hair System" },
  { name: "Skin Base Hair System", price: 15000, quantity: 3, category: "Hair System" },
];

/* ---------- Spreadsheet import ---------- */

function normaliseName(raw: string) {
  // Trim, collapse spaces, fix common spelling in the sheet, title-case words.
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const fixes: Record<string, string> = {
    "scalp protecter": "Scalp Protector",
    softner: "Softener",
    "small softner c-1": "Small Softener C-1",
  };
  const lower = cleaned.toLowerCase();
  if (fixes[lower]) return fixes[lower];
  return cleaned
    .split(" ")
    .map((w) => {
      if (/^[a-z]-\d+$/i.test(w)) return w.toUpperCase(); // c-22 -> C-22
      if (/^d-divine$/i.test(w)) return "D-Divine";
      if (/^\d+f$/i.test(w)) return w.toUpperCase(); // 100f -> 100F
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ")
    .replace(/\bSoftner\b/g, "Softener");
}

function guessCategory(name: string): string {
  const n = name.toLowerCase();
  if (/(tape|yard|johnson|divine|cotton)/.test(n)) return "Tape";
  if (/glue/.test(n)) return "Glue";
  if (/(lacehold|ultrahold|hold)/.test(n)) return "Adhesive";
  if (/(c-22|remover|solvent)/.test(n)) return "Solvent / Remover";
  if (/soft/.test(n)) return "Softener";
  if (/scalp/.test(n)) return "Scalp Care";
  if (/(iron|tool|scissor|brush|comb)/.test(n)) return "Tool";
  if (/topper/.test(n)) return "Topper";
  if (/wig/.test(n)) return "Wig";
  if (/(drawn|extension)/.test(n)) return "Hair Extension";
  if (/(system|lace|skin base)/.test(n)) return "Hair System";
  return "Hair Accessory";
}

function readSpreadsheet(file: string): SeedProduct[] | null {
  if (!fs.existsSync(file)) return null;
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const out: SeedProduct[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const keys = Object.keys(row);
    const nameKey = keys.find((k) => /product/i.test(k));
    const priceKey = keys.find((k) => /price/i.test(k));
    const qtyKey = keys.find((k) => /stock|qty|quantity/i.test(k));
    if (!nameKey) continue;
    const rawName = row[nameKey];
    if (typeof rawName !== "string" || !rawName.trim()) continue; // skip empty rows
    const name = normaliseName(rawName);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const priceRaw = priceKey ? row[priceKey] : null;
    const qtyRaw = qtyKey ? row[qtyKey] : null;
    const price = typeof priceRaw === "number" && Number.isFinite(priceRaw) ? priceRaw : null;
    const quantity = typeof qtyRaw === "number" && Number.isFinite(qtyRaw) ? Math.max(0, Math.round(qtyRaw)) : 0;
    out.push({ name, price, quantity, category: guessCategory(name) });
  }
  return out;
}

/* ---------- Main ---------- */

async function main() {
  console.log("Seeding...");

  // Settings
  await prisma.businessSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", businessName: "Salon & Hair Studio", currencyCode: "INR", currencySymbol: "₹", lowStockThreshold: 4 },
  });

  // Categories
  for (const [i, name] of CATEGORIES.entries()) {
    await prisma.category.upsert({ where: { name }, update: { sortOrder: i }, create: { name, sortOrder: i } });
  }
  const categories = await prisma.category.findMany();
  const categoryId = (name: string) => categories.find((c) => c.name === name)?.id ?? categories.find((c) => c.name === "Other")!.id;

  // Users
  const owner = await prisma.user.upsert({
    where: { email: "owner@salon.local" },
    update: {},
    create: { name: "Akshay Kumar", email: "owner@salon.local", passwordHash: await hashPassword(OWNER_PASSWORD), role: "OWNER" },
  });
  const manager = await prisma.user.upsert({
    where: { email: "manager@salon.local" },
    update: {},
    create: { name: "Manager", email: "manager@salon.local", passwordHash: await hashPassword(MANAGER_PASSWORD), role: "MANAGER" },
  });
  console.log(`Users ready: ${owner.email} (OWNER), ${manager.email} (MANAGER)`);

  // Inventory
  const sheetPath = path.resolve(process.cwd(), "data", "Hair accesories.xlsx");
  const fromSheet = readSpreadsheet(sheetPath);
  const products = [...(fromSheet ?? FALLBACK_PRODUCTS), ...HAIR_PRODUCTS];
  console.log(fromSheet ? `Importing ${fromSheet.length} products from ${path.basename(sheetPath)}` : "Spreadsheet not found; using built-in inventory list");

  let created = 0;
  for (const p of products) {
    const existing = await prisma.product.findFirst({ where: { name: { equals: p.name, mode: "insensitive" } } });
    if (existing) continue;
    await prisma.$transaction(async (tx) => {
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('product_number_seq') AS n`;
      const product = await tx.product.create({
        data: {
          productNumber: `PRD-${String(Number(n)).padStart(6, "0")}`,
          name: p.name,
          categoryId: categoryId(p.category),
          sellingPrice: p.price === null ? null : p.price.toFixed(2),
          quantity: p.quantity,
          unit: "PIECE",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
      if (p.quantity > 0) {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: "INITIAL_STOCK",
            quantityChange: p.quantity,
            previousQuantity: 0,
            newQuantity: p.quantity,
            note: fromSheet ? "Imported from stock sheet" : "Opening stock",
            performedById: owner.id,
          },
        });
      }
    });
    created++;
  }
  console.log(`Products: ${created} created, ${products.length - created} already existed`);

  const count = await prisma.product.count();
  console.log(`Done. ${count} products in database.`);
  console.log("\nDemo credentials:");
  console.log(`  Owner:   owner@salon.local / ${OWNER_PASSWORD}`);
  console.log(`  Manager: manager@salon.local / ${MANAGER_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

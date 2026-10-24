import type { BillDTO } from "@/lib/services/billing";
import { SHARE_LINK_DAYS, SHOP_ONLINE_URL } from "@/lib/constants";
import { formatDate, formatMoney } from "@/lib/format";
import { paymentMethodsLabel } from "@/components/app/bill-badges";

/**
 * The WhatsApp message sent to the customer with their bill: what they had, what they
 * paid (or still owe), the link to view/download the bill, and the salon's online shop.
 * *text* is WhatsApp's bold. Only plain symbols (➜ ★ ₹ •): emoji, and symbols phones draw as
 * emoji such as ♥ ✔, came out as � boxes on the salon's tablet through a wa.me link.
 */
export function buildBillWhatsappMessage(bill: BillDTO, billUrl: string, businessName: string, currencySymbol: string): string {
  const sym = currencySymbol;
  const due = Number(bill.balanceDue) > 0;
  const name = bill.customerName?.trim();
  const lines = [
    `Hi${name ? ` ${name}` : ""}, thank you for visiting *${businessName}*!`,
    "",
    `*Bill No:* ${bill.billNumber} · ${formatDate(bill.createdAt)}`,
    ...bill.items.map((i) => `• ${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ""} – ${formatMoney(i.lineTotal, sym)}`),
    ...(Number(bill.discount) > 0 ? [`Discount – ${formatMoney(bill.discount, sym)}`] : []),
    `*Total: ${formatMoney(bill.total, sym)}*${!due && bill.payments.length ? ` (Paid by ${paymentMethodsLabel(bill.payments)})` : ""}`,
    ...(due ? [`Paid: ${formatMoney(bill.amountPaid, sym)} · *Balance due: ${formatMoney(bill.balanceDue, sym)}*`] : []),
    "",
    `➜ View / download your bill (link works for ${SHARE_LINK_DAYS} days):`,
    billUrl,
    "",
    "★ Shop our products online:",
    SHOP_ONLINE_URL,
    "",
    "See you again soon!",
  ];
  return lines.join("\n");
}

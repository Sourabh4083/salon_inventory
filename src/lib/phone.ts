/**
 * Phone numbers are typed in many shapes ("+91 98765-43210", "098765 43210",
 * "9876543210"). The last 10 digits identify an Indian mobile number, so that is
 * the key used to match the same person across enquiries and bills.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Link for WhatsApp; 10-digit numbers are assumed to be Indian (+91). */
export function whatsappLink(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
}

/** Link for dialing, keeping a leading + if there was one. */
export function telLink(raw: string): string {
  return `tel:${raw.trim().startsWith("+") ? "+" : ""}${raw.replace(/\D/g, "")}`;
}

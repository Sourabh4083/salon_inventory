import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Manrope, Fraunces, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const manrope = Manrope({ variable: "--font-sans", subsets: ["latin"], display: "swap" });
const fraunces = Fraunces({ variable: "--font-heading", subsets: ["latin"], display: "swap", axes: ["opsz"] });
const geistMono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Salon Inventory", template: "%s · Salon Inventory" },
  description: "Inventory management for salon, hair system and wig products.",
  applicationName: "Salon Inventory",
};

/** Night mode is remembered per device in a cookie (set by ThemeToggle), so the server renders the right colours. */
async function isNightMode() {
  return (await cookies()).get("theme")?.value === "dark";
}

export async function generateViewport(): Promise<Viewport> {
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: (await isNightMode()) ? "#221c21" : "#f9f6f1",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const night = await isNightMode();
  return (
    <html lang="en" className={`${manrope.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased${night ? " dark" : ""}`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" theme={night ? "dark" : "light"} richColors closeButton toastOptions={{ duration: 3500 }} />
      </body>
    </html>
  );
}

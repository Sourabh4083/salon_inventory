import type { Metadata, Viewport } from "next";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f9f6f1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" richColors closeButton toastOptions={{ duration: 3500 }} />
      </body>
    </html>
  );
}

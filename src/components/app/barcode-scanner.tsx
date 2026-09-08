"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CameraOff, LoaderCircle, ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { lookupProductByCodeAction } from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ScannerControls = { stop: () => void };

/**
 * Optional enhancement: phone-camera barcode scanning using @zxing/browser.
 * Also includes a plain input so USB scanners (which act as keyboards) work without a camera.
 */
export function BarcodeScanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const busyRef = useRef(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const stop = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setActive(false);
  };

  useEffect(() => () => stop(), []);

  const handleCode = async (code: string) => {
    const value = code.trim();
    if (!value || busyRef.current) return;
    busyRef.current = true;
    setLookingUp(true);
    setLastCode(value);
    try {
      const res = await lookupProductByCodeAction(value);
      if (res.ok && res.data) {
        stop();
        toast.success(`Found ${res.data.name}`);
        router.push(`/inventory/${res.data.id}?from=scan`);
      } else {
        toast.error(`No product with barcode ${value}`, {
          description: "Add it to the product when creating or editing it.",
        });
        // allow another scan after a short pause so the same code is not spammed
        setTimeout(() => (busyRef.current = false), 1500);
      }
    } finally {
      setLookingUp(false);
    }
  };

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not available in this browser. Use HTTPS or a modern browser.");
      }
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const video = videoRef.current;
      if (!video) throw new Error("Video element missing");
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        video,
        (result) => {
          if (result) void handleCode(result.getText());
        },
      );
      controlsRef.current = controls;
      busyRef.current = false;
      setActive(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start the camera.";
      setError(/permission|denied|notallowed/i.test(message) ? "Camera permission was denied. Allow camera access and try again." : message);
      setActive(false);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border bg-black shadow-xs">
        <div className="relative aspect-[4/3] w-full sm:aspect-video">
          <video ref={videoRef} className="size-full object-cover" muted playsInline autoPlay />
          {!active ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sidebar/95 p-6 text-center text-sidebar-foreground">
              <span className="flex size-14 items-center justify-center rounded-full bg-sidebar-accent">
                <ScanBarcode className="size-7" />
              </span>
              <p className="max-w-xs text-sm text-sidebar-foreground/80">
                Point your phone camera at a product barcode. The product opens automatically when recognised.
              </p>
              <Button size="lg" className="h-11" onClick={start} disabled={starting}>
                {starting ? <LoaderCircle className="animate-spin" /> : <Camera />} Start camera
              </Button>
              {error ? <p className="max-w-xs text-xs text-red-300">{error}</p> : null}
            </div>
          ) : (
            <>
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-primary/80 shadow-[0_0_12px_2px_var(--primary)]" />
              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                {lookingUp ? <LoaderCircle className="size-5 animate-spin text-white" /> : null}
                <Button size="sm" variant="secondary" onClick={stop}>
                  <CameraOff /> Stop
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
      {lastCode ? <p className="text-xs text-muted-foreground">Last scanned: <span className="font-mono">{lastCode}</span></p> : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleCode(manual);
          busyRef.current = false;
        }}
        className="rounded-2xl border bg-card p-4 shadow-xs"
      >
        <label htmlFor="manual-code" className="text-sm font-medium">
          Or enter / scan a barcode with a USB scanner
        </label>
        <div className="mt-2 flex gap-2">
          <Input
            id="manual-code"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Barcode, SKU or product number"
            className="h-11 font-mono text-base"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
          />
          <Button type="submit" size="lg" className="h-11" disabled={!manual.trim() || lookingUp}>
            {lookingUp ? <LoaderCircle className="animate-spin" /> : <ScanBarcode />} Find
          </Button>
        </div>
      </form>
    </div>
  );
}

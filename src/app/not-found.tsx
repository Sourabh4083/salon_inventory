import Link from "next/link";
import { PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <PackageSearch className="size-6" />
      </span>
      <h1 className="mt-5 font-heading text-3xl">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">The page or product you are looking for does not exist or was moved.</p>
      <Button size="lg" className="mt-6 h-11" render={<Link href="/dashboard" />}>
        Go to dashboard
      </Button>
    </main>
  );
}

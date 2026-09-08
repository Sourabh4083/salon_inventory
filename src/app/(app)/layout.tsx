import { requireUserPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { AppShell } from "@/components/app/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, settings] = await Promise.all([requireUserPage(), getSettings()]);
  return (
    <AppShell user={user} businessName={settings.businessName}>
      {children}
    </AppShell>
  );
}

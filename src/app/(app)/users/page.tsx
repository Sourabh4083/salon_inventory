import type { Metadata } from "next";
import { requirePermissionPage } from "@/lib/auth/guards";
import { listUsers } from "@/lib/services/users";
import { PageHeader } from "@/components/app/page-header";
import { UsersManager } from "@/components/app/users-manager";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requirePermissionPage("user.manage");
  const users = await listUsers();
  return (
    <div className="space-y-5">
      <PageHeader title="Users" description="Manager accounts can run daily inventory. Only the owner manages users and settings." />
      <UsersManager users={users} currentUserId={me.id} />
    </div>
  );
}

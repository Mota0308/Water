import { redirect } from "next/navigation";
import { FIXED_UNITS } from "@/application/store-work-flow-app";
import { AccountAdminForms } from "@/app/accounts/account-admin-forms";
import { AppShell } from "@/components/app-shell";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function AccountsPage() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);

  if (!auth.ok) {
    redirect("/login");
  }
  if (auth.session.role !== "system_admin") {
    redirect("/");
  }

  const listed = await app.listAccounts(auth.session.sessionId);
  const accounts = listed.ok ? listed.accounts : [];

  return (
    <AppShell session={auth.session} active="accounts">
      <section className="personal-card">
        <h1 className="personal-card-title">個人賬號管理</h1>
        <p className="meta">僅系統管理員可建立、重設、暫停及調職</p>
      </section>
      <AccountAdminForms units={[...FIXED_UNITS]} accounts={accounts} />
    </AppShell>
  );
}

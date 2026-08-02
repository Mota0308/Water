import Link from "next/link";
import { redirect } from "next/navigation";
import { FIXED_UNITS } from "@/application/store-work-flow-app";
import { AccountAdminForms } from "@/app/accounts/account-admin-forms";
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
    <main className="page">
      <header className="page-header">
        <div>
          <h1>個人賬號管理</h1>
          <p>僅系統管理員可建立、重設、暫停及調職</p>
        </div>
        <Link href="/">返回今日工作</Link>
      </header>

      <AccountAdminForms units={[...FIXED_UNITS]} accounts={accounts} />
    </main>
  );
}

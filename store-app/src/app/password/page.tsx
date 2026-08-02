import Link from "next/link";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/app/password/change-password-form";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function PasswordPage() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) {
    redirect("/login");
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>修改密碼</h1>
          <p>{auth.session.displayName}</p>
        </div>
        <Link href="/">返回</Link>
      </header>
      <section className="card">
        <ChangePasswordForm />
      </section>
    </main>
  );
}

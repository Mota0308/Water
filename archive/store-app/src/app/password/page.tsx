import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/app/password/change-password-form";
import { AppShell } from "@/components/app-shell";
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
    <AppShell session={auth.session} active="password">
      <section className="personal-card">
        <h1 className="personal-card-title">修改密碼</h1>
        <ChangePasswordForm />
      </section>
    </AppShell>
  );
}

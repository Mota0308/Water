import { redirect } from "next/navigation";
import { LoginForm } from "@/app/login/login-form";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function LoginPage() {
  const sessionId = await readSessionId();
  if (sessionId) {
    const app = await getStoreWorkFlowApp();
    const session = await app.getSession(sessionId);
    if (session) {
      redirect("/");
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <h1>門市工作流程系統</h1>
        <p>公司內部使用 · 請以個人賬號登入</p>
        <LoginForm />
        <p className="login-hint">忘記密碼請聯絡系統管理員重設。</p>
      </section>
    </main>
  );
}

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
    <main className="login-page login-page-v2">
      <section className="login-panel login-panel-v2">
        <div className="login-brand">
          <span className="personal-brand-icon" aria-hidden>
            ▦
          </span>
          <h1>店鋪員工系統</h1>
        </div>
        <p>每日工作流程 · 開發及生產 · 補貨</p>
        <LoginForm />
        <p className="login-hint">忘記密碼請聯絡系統管理員重設。</p>
      </section>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function HomePage() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);

  if (!auth.ok) {
    redirect("/login");
  }

  const { session } = auth;

  return (
    <main className="home-page">
      <header className="home-header">
        <div>
          <h1>今日工作</h1>
          <p>
            {session.displayName} · {roleLabel(session.role)}
            {session.fixedUnit ? ` · ${session.fixedUnit}` : ""}
          </p>
        </div>
        <div className="header-actions">
          <Link href="/password">修改密碼</Link>
          {session.role === "system_admin" ? (
            <Link href="/accounts">賬號管理</Link>
          ) : null}
          <form action={logoutAction}>
            <button type="submit">登出</button>
          </form>
        </div>
      </header>
      <section className="home-empty">
        <p>
          {session.role === "personal"
            ? `你已進入固定單位「${session.fixedUnit}」範圍。後續票據會在此顯示今日工作清單。`
            : "已成功登入。後續票據會在此顯示管理工作與進度。"}
        </p>
      </section>
    </main>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case "system_admin":
      return "系統管理員";
    case "manager":
      return "一般管理層";
    case "personal":
      return "個人賬號";
    default:
      return role;
  }
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import {
  cancelCompletionAction,
  completeWorkAction,
} from "@/app/actions/work";
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
  const today = await app.getTodayWork(session.sessionId);
  const works = today.ok ? today.works : [];
  const summary = today.ok
    ? today.summary
    : { total: 0, completed: 0, pending: 0, overdue: 0, percent: 0 };

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
          <Link href="/progress">各單位進度</Link>
          <Link href="/password">修改密碼</Link>
          {session.role !== "personal" ? (
            <>
              <Link href="/work/new">新增突發工作</Link>
              <Link href="/work/recurring">新增恆常工作</Link>
            </>
          ) : null}
          {session.role === "system_admin" ? (
            <Link href="/accounts">賬號管理</Link>
          ) : null}
          <form action={logoutAction}>
            <button type="submit">登出</button>
          </form>
        </div>
      </header>

      <section className="summary-bar card">
        <span>總數 {summary.total}</span>
        <span>已完成 {summary.completed}</span>
        <span>未完成 {summary.pending}</span>
        <span>逾期 {summary.overdue}</span>
        <span>完成率 {summary.percent}%</span>
      </section>

      <section className="work-list">
        {works.length === 0 ? (
          <div className="home-empty">
            <p>目前沒有工作項目。管理層可新增突發工作。</p>
          </div>
        ) : (
          works.map((work) => (
            <article key={work.id} className={`card work-item status-${work.status}`}>
              <div>
                <h2>{work.title}</h2>
                <p>{work.content}</p>
                <p className="meta">
                  {work.unit} · {priorityLabel(work.priority)} ·{" "}
                  {work.status === "completed"
                    ? `已完成（${work.completedByDisplayName}）`
                    : work.dueAt
                      ? `期限 ${work.dueAt.toLocaleString("zh-HK")}`
                      : "未完成"}
                </p>
              </div>
              {session.role === "personal" ? (
                <div className="work-actions">
                  {work.status === "pending" ? (
                    <form action={completeWorkAction}>
                      <input type="hidden" name="workId" value={work.id} />
                      <button type="submit">剔選完成</button>
                    </form>
                  ) : null}
                  {work.status === "completed" &&
                  work.completedByAccountId === session.accountId ? (
                    <form action={cancelCompletionAction}>
                      <input type="hidden" name="workId" value={work.id} />
                      <button type="submit" className="secondary">
                        取消剔選
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))
        )}
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

function priorityLabel(priority: string): string {
  switch (priority) {
    case "urgent":
      return "緊急";
    case "important":
      return "重要";
    default:
      return "一般";
  }
}

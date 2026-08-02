import Link from "next/link";
import { redirect } from "next/navigation";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function ProgressPage() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) redirect("/login");

  const progress = await app.listUnitProgress(auth.session.sessionId);
  if (!progress.ok) redirect("/login");

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>各單位進度</h1>
          <p>{progress.readOnlyNotice}</p>
        </div>
        <Link href="/">返回今日工作</Link>
      </header>

      <section className="work-list">
        {progress.units.map((unit) => (
          <article key={unit.unit} className="card">
            <div className="page-header" style={{ marginBottom: 0, border: 0 }}>
              <div>
                <h2 style={{ margin: 0 }}>{unit.unit}</h2>
                <p>
                  總數 {unit.total} · 已完成 {unit.completed} · 未完成{" "}
                  {unit.pending} · 逾期 {unit.overdue} · {unit.percent}%
                </p>
              </div>
              <Link href={`/progress/${encodeURIComponent(unit.unit)}`}>
                查看詳情
              </Link>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

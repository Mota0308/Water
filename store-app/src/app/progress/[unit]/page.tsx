import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  FIXED_UNITS,
  type FixedUnit,
} from "@/application/store-work-flow-app";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function UnitProgressPage({
  params,
}: {
  params: Promise<{ unit: string }>;
}) {
  const { unit: rawUnit } = await params;
  const unit = decodeURIComponent(rawUnit) as FixedUnit;
  if (!(FIXED_UNITS as readonly string[]).includes(unit)) {
    notFound();
  }

  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) redirect("/login");

  const view = await app.getUnitWorkReadonly(auth.session.sessionId, { unit });
  if (!view.ok) redirect("/progress");

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>{unit}進度</h1>
          <p>{view.readOnlyNotice}</p>
        </div>
        <Link href="/progress">返回各單位進度</Link>
      </header>

      <section className="summary-bar card">
        <span>總數 {view.summary.total}</span>
        <span>已完成 {view.summary.completed}</span>
        <span>未完成 {view.summary.pending}</span>
        <span>逾期 {view.summary.overdue}</span>
        <span>完成率 {view.summary.percent}%</span>
      </section>

      <section className="work-list">
        {view.works.length === 0 ? (
          <div className="home-empty">
            <p>此單位今日沒有工作項目。</p>
          </div>
        ) : (
          view.works.map((work) => (
            <article key={work.id} className="card">
              <h2 style={{ marginTop: 0 }}>{work.title}</h2>
              <p className="meta">
                {work.status === "completed"
                  ? `已完成 · ${work.completedByDisplayName} · ${work.completedAt?.toLocaleString("zh-HK")}`
                  : work.dueAt
                    ? `未完成 · 期限 ${work.dueAt.toLocaleString("zh-HK")}`
                    : "未完成"}
              </p>
              <p className="meta">
                最後更新 {work.lastUpdatedAt.toLocaleString("zh-HK")}
              </p>
            </article>
          ))
        )}
      </section>
    </main>
  );
}

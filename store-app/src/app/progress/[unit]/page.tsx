import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  FIXED_UNITS,
  type FixedUnit,
} from "@/application/store-work-flow-app";
import { AppShell } from "@/components/app-shell";
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
    <AppShell session={auth.session} active="progress">
      <div className="personal-detail-head">
        <h1 className="personal-card-title" style={{ margin: 0 }}>
          {unit}進度
        </h1>
        <Link href="/progress" className="text-btn">
          返回各單位進度
        </Link>
      </div>

      <section className="personal-card summary-bar">
        <span>總數 {view.summary.total}</span>
        <span>已完成 {view.summary.completed}</span>
        <span>未完成 {view.summary.pending}</span>
        <span>逾期 {view.summary.overdue}</span>
        <span>完成率 {view.summary.percent}%</span>
      </section>

      <section className="personal-card">
        <p className="meta" style={{ marginBottom: "1rem" }}>
          {view.readOnlyNotice}
        </p>
        {view.works.length === 0 ? (
          <p className="meta">此單位今日沒有工作項目。</p>
        ) : (
          <ul className="task-list">
            {view.works.map((work) => (
              <li key={work.id} className="task-row">
                <div className="task-body">
                  <div className="task-title-row">
                    <span className="task-title">{work.title}</span>
                    <span className={`pill priority-${work.priority}`}>
                      {work.priority === "urgent"
                        ? "緊急"
                        : work.priority === "important"
                          ? "重要"
                          : "一般"}
                    </span>
                  </div>
                  <p className="meta">
                    {work.status === "completed"
                      ? `已完成 · ${work.completedByDisplayName} · ${work.completedAt?.toLocaleString("zh-HK")}`
                      : work.dueAt && work.dueAt.getTime() < Date.now()
                        ? `已逾期 · 期限 ${work.dueAt.toLocaleString("zh-HK")}`
                        : work.dueAt
                          ? `未完成 · 期限 ${work.dueAt.toLocaleString("zh-HK")}`
                          : "未完成"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

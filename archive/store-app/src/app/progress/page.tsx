import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function ProgressPage() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) redirect("/login");

  const progress = await app.listUnitProgress(auth.session.sessionId);
  if (!progress.ok) redirect("/login");

  const updatedAt = new Date().toLocaleTimeString("zh-HK", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Hong_Kong",
  });

  return (
    <AppShell session={auth.session} active="progress">
      <section className="personal-card">
        <h1 className="personal-card-title">各單位今日進度</h1>
        <p className="meta">
          按入單位可查看工作詳情 · 最後更新：{updatedAt}
        </p>
        <ul className="unit-progress-list">
          {progress.units.map((unit) => {
            const isHome =
              auth.session.role === "personal" &&
              unit.unit === auth.session.fixedUnit;
            return (
              <li key={unit.unit}>
                <Link
                  href={`/progress/${encodeURIComponent(unit.unit)}`}
                  className={`unit-progress-row${isHome ? " is-home" : ""}`}
                >
                  <div className="unit-progress-head">
                    <strong>
                      {isHome ? (
                        <span className="home-mark" aria-label="所屬單位" />
                      ) : null}
                      {unit.unit}
                    </strong>
                    <span className="meta">
                      總數 {unit.total} | 已完成 {unit.completed} | 未完成{" "}
                      {unit.pending} |{" "}
                      <span className="tone-danger">逾期 {unit.overdue}</span>
                    </span>
                  </div>
                  <div className="personal-progress">
                    <div className="personal-progress-track">
                      <div
                        className="personal-progress-bar"
                        style={{ width: `${unit.percent}%` }}
                      />
                    </div>
                    <span>{unit.percent}%</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </AppShell>
  );
}

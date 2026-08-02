import Link from "next/link";
import { redirect } from "next/navigation";
import { FIXED_UNITS } from "@/application/store-work-flow-app";
import { HistoryPanel } from "@/app/history/history-panel";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; status?: string }>;
}) {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) redirect("/login");
  if (auth.session.role === "personal") redirect("/");

  const params = await searchParams;
  const unit = FIXED_UNITS.find((item) => item === params.unit);
  const status =
    params.status === "completed" || params.status === "pending"
      ? params.status
      : undefined;

  const history = await app.searchWorkHistory(auth.session.sessionId, {
    unit,
    status,
  });
  const stats = await app.getStaffStats(auth.session.sessionId, { unit });
  const exportResult = await app.exportWorkHistoryCsv(auth.session.sessionId, {
    unit,
    status,
  });

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>歷史與統計</h1>
          <p>管理層可篩選、查看人員完成量並匯出 CSV</p>
        </div>
        <Link href="/">返回今日工作</Link>
      </header>
      <HistoryPanel
        units={[...FIXED_UNITS]}
        selectedUnit={unit ?? ""}
        selectedStatus={status ?? ""}
        works={history.ok ? history.works : []}
        stats={stats.ok ? stats.stats : []}
        csv={exportResult.ok ? exportResult.csv : ""}
      />
    </main>
  );
}

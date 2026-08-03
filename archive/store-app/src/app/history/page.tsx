import { redirect } from "next/navigation";
import {
  FIXED_UNITS,
  type WorkPriority,
  type WorkType,
} from "@/application/store-work-flow-app";
import { HistoryPanel } from "@/app/history/history-panel";
import { AppShell } from "@/components/app-shell";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    unit?: string;
    status?: string;
    priority?: string;
    type?: string;
    overdue?: string;
  }>;
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
  const priority =
    params.priority === "normal" ||
    params.priority === "important" ||
    params.priority === "urgent"
      ? (params.priority as WorkPriority)
      : undefined;
  const type =
    params.type === "adhoc" ||
    params.type === "recurring" ||
    params.type === "daily_settlement"
      ? (params.type as WorkType)
      : undefined;
  const overdueOnly = params.overdue === "1";

  const history = await app.searchWorkHistory(auth.session.sessionId, {
    unit,
    status,
    priority,
    type,
    overdueOnly,
  });
  const stats = await app.getStaffStats(auth.session.sessionId, { unit });
  const exportResult = await app.exportWorkHistoryCsv(auth.session.sessionId, {
    unit,
    status,
    priority,
    type,
    overdueOnly,
  });

  return (
    <AppShell session={auth.session} active="history">
      <section className="personal-card">
        <h1 className="personal-card-title">歷史與統計</h1>
        <p className="meta">管理層可篩選、查看人員完成量並匯出 CSV</p>
      </section>
      <HistoryPanel
        units={[...FIXED_UNITS]}
        selectedUnit={unit ?? ""}
        selectedStatus={status ?? ""}
        selectedPriority={priority ?? ""}
        selectedType={type ?? ""}
        overdueOnly={overdueOnly}
        works={history.ok ? history.works : []}
        stats={stats.ok ? stats.stats : []}
        csv={exportResult.ok ? exportResult.csv : ""}
      />
    </AppShell>
  );
}

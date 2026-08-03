import { redirect } from "next/navigation";
import { WatchedUnitsForm } from "@/app/settings/watched-units-form";
import { AppShell } from "@/components/app-shell";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function SettingsPage() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) redirect("/login");
  if (auth.session.role !== "personal") redirect("/");

  return (
    <AppShell session={auth.session} active="settings">
      <section className="personal-card">
        <h1 className="personal-card-title">個人設置</h1>
        <p className="meta">
          選擇關注地區後，今日工作僅顯示這些地區的任務。完成權仍以所屬單位／負責人為準。
        </p>
        <WatchedUnitsForm
          watchedUnits={auth.session.watchedUnits}
          fixedUnit={auth.session.fixedUnit}
        />
      </section>
    </AppShell>
  );
}

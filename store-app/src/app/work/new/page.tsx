import { redirect } from "next/navigation";
import { FIXED_UNITS } from "@/application/store-work-flow-app";
import { CreateAdhocForm } from "@/app/work/new/create-adhoc-form";
import { loadHandlersByUnit } from "@/app/work/load-unit-handlers";
import { AppShell } from "@/components/app-shell";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function NewWorkPage() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) {
    redirect("/login");
  }
  if (auth.session.role === "personal") {
    redirect("/");
  }

  const handlersByUnit = await loadHandlersByUnit(auth.session.sessionId);

  return (
    <AppShell session={auth.session} active="new">
      <section className="personal-card">
        <h1 className="personal-card-title">新增突發工作</h1>
        <p className="meta">先選地區，再為各地區指定負責人（可留空）</p>
        <CreateAdhocForm
          units={[...FIXED_UNITS]}
          handlersByUnit={handlersByUnit}
        />
      </section>
    </AppShell>
  );
}

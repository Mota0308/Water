import { redirect } from "next/navigation";
import { FIXED_UNITS } from "@/application/store-work-flow-app";
import { CreateAdhocForm } from "@/app/work/new/create-adhoc-form";
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

  return (
    <AppShell session={auth.session} active="new">
      <section className="personal-card">
        <h1 className="personal-card-title">新增突發工作</h1>
        <p className="meta">可同時分配給多個單位</p>
        <CreateAdhocForm units={[...FIXED_UNITS]} />
      </section>
    </AppShell>
  );
}

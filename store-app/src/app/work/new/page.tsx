import Link from "next/link";
import { redirect } from "next/navigation";
import { FIXED_UNITS } from "@/application/store-work-flow-app";
import { CreateAdhocForm } from "@/app/work/new/create-adhoc-form";
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
    <main className="page">
      <header className="page-header">
        <div>
          <h1>新增突發工作</h1>
          <p>可同時分配給多個單位</p>
        </div>
        <Link href="/">返回今日工作</Link>
      </header>
      <section className="card">
        <CreateAdhocForm units={[...FIXED_UNITS]} />
      </section>
    </main>
  );
}

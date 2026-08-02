import Link from "next/link";
import { redirect } from "next/navigation";
import { FIXED_UNITS } from "@/application/store-work-flow-app";
import { seedDemoAction } from "@/app/actions/demo";
import { CreateRecurringForm } from "@/app/work/recurring/create-recurring-form";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function RecurringWorkPage() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) redirect("/login");
  if (auth.session.role === "personal") redirect("/");

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>新增恆常工作</h1>
          <p>每日／平日自動產生；未完成會跨日延續同一筆</p>
        </div>
        <Link href="/">返回今日工作</Link>
      </header>
      <section className="card">
        <form action={seedDemoAction}>
          <button type="submit">載入示範恆常工作種子</button>
        </form>
      </section>
      <section className="card">
        <CreateRecurringForm units={[...FIXED_UNITS]} />
      </section>
    </main>
  );
}

import { redirect } from "next/navigation";
import { FIXED_UNITS } from "@/application/store-work-flow-app";
import { seedDemoAction } from "@/app/actions/demo";
import { deactivateRecurringAction } from "@/app/actions/work";
import { loadHandlersByUnit } from "@/app/work/load-unit-handlers";
import { CreateRecurringForm } from "@/app/work/recurring/create-recurring-form";
import { AppShell } from "@/components/app-shell";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function RecurringWorkPage() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) redirect("/login");
  if (auth.session.role === "personal") redirect("/");

  const templates = await app.listRecurringTemplates(auth.session.sessionId);
  const handlersByUnit = await loadHandlersByUnit(auth.session.sessionId);

  return (
    <AppShell session={auth.session} active="recurring">
      <section className="personal-card">
        <h1 className="personal-card-title">新增恆常工作</h1>
        <p className="meta">
          每日／平日自動產生；可為各地區指定負責人；未完成會跨日延續同一筆
        </p>
        <form action={seedDemoAction} style={{ marginBottom: "1rem" }}>
          <button type="submit" className="secondary-btn">
            載入示範恆常工作種子
          </button>
        </form>
        <CreateRecurringForm
          units={[...FIXED_UNITS]}
          handlersByUnit={handlersByUnit}
        />
      </section>

      <section className="personal-card stack">
        <h2 className="personal-card-title">現有恆常模板</h2>
        {!templates.ok || templates.templates.length === 0 ? (
          <p className="meta">尚無模板</p>
        ) : (
          <ul className="account-list">
            {templates.templates.map((template) => (
              <li key={template.id} className="account-item shell-item">
                <strong>
                  {template.title}
                  {template.active ? "" : "（已停用）"}
                </strong>
                <p className="meta">
                  {template.recurrence} · {template.priority} ·{" "}
                  {template.units.join("、")}
                  {template.sensitive ? " · 敏感" : ""}
                </p>
                {template.active ? (
                  <form action={deactivateRecurringAction}>
                    <input
                      type="hidden"
                      name="templateId"
                      value={template.id}
                    />
                    <button type="submit" className="secondary-btn">
                      停用模板
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

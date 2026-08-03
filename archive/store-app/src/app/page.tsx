import { redirect } from "next/navigation";
import { ManagerTodayView } from "@/app/today/manager-today";
import { PersonalTodayView } from "@/app/today/personal-today";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function HomePage() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);

  if (!auth.ok) {
    redirect("/login");
  }

  const { session } = auth;
  const today = await app.getTodayWork(session.sessionId);
  const works = today.ok ? today.works : [];
  const summary = today.ok
    ? today.summary
    : { total: 0, completed: 0, pending: 0, overdue: 0, percent: 0 };

  if (session.role === "personal") {
    return (
      <PersonalTodayView session={session} works={works} summary={summary} />
    );
  }

  return (
    <ManagerTodayView session={session} works={works} summary={summary} />
  );
}

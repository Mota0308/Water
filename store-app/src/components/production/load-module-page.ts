import { redirect } from "next/navigation";
import type { AppModule } from "@/application/app-module";
import type {
  ProductionMentionView,
  ProductionProjectView,
} from "@/application/production-domain";
import { projectTypeForModule } from "@/application/production-module-paths";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export type ProdModule = Extract<AppModule, "production" | "replenishment">;

export async function requireProdSession() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) redirect("/login");
  return { app, session: auth.session, sessionId: auth.session.sessionId };
}

export async function loadHomeData(module: ProdModule) {
  const { app, session, sessionId } = await requireProdSession();
  const type = projectTypeForModule(module);
  const summaryResult = await app.getProductionHomeSummary(sessionId, { type });
  const summary = summaryResult.ok
    ? summaryResult.summary
    : { total: 0, waitingConfirm: 0, needFix: 0, myTaskCount: 0 };

  const tasksResult = await app.listMyProductionTasks(sessionId, { type });
  const tasks = tasksResult.ok ? tasksResult.tasks : [];

  let waitingProjects: ProductionProjectView[] = [];
  if (session.role === "system_admin") {
    const listed = await app.listProductionProjects(sessionId, {
      type,
      status: "待確認",
    });
    waitingProjects = listed.ok ? listed.projects : [];
  }

  const mentionsResult = await app.listMyMentions(sessionId, { type });
  const mentions: ProductionMentionView[] = mentionsResult.ok
    ? mentionsResult.mentions
    : [];

  return { session, summary, tasks, waitingProjects, mentions };
}

export async function loadListData(
  module: ProdModule,
  filters: { category?: string; status?: string; keyword?: string },
) {
  const { app, session, sessionId } = await requireProdSession();
  const type = projectTypeForModule(module);
  const category = filters.category?.trim() || "全部";
  const status = filters.status?.trim() || "全部";
  const keyword = filters.keyword?.trim() || "";
  const listed = await app.listProductionProjects(sessionId, {
    type,
    category,
    status,
    keyword,
  });
  return {
    session,
    projects: listed.ok ? listed.projects : [],
    filters: { category, status, keyword },
  };
}

export async function loadCreateData(module: ProdModule) {
  const { app, session, sessionId } = await requireProdSession();
  if (session.role !== "system_admin") {
    redirect(module === "production" ? "/production" : "/replenishment");
  }
  const handlers = await app.listPersonalHandlers(sessionId);
  return {
    session,
    handlers: handlers.ok ? handlers.handlers : [],
  };
}

export async function loadMyTasksData(module: ProdModule) {
  const { app, session, sessionId } = await requireProdSession();
  const type = projectTypeForModule(module);
  const tasksResult = await app.listMyProductionTasks(sessionId, { type });
  return { session, tasks: tasksResult.ok ? tasksResult.tasks : [] };
}

export async function loadDetailData(module: ProdModule, projectId: string) {
  const { app, session, sessionId } = await requireProdSession();
  const type = projectTypeForModule(module);
  const result = await app.getProductionProject(sessionId, { projectId });
  if (!result.ok) {
    redirect(module === "production" ? "/production/list" : "/replenishment/list");
  }
  if (result.project.type !== type) {
    const other = result.project.type === "dev" ? "/production" : "/replenishment";
    redirect(`${other}/projects/${projectId}`);
  }

  let handlers: {
    accountId: string;
    displayName: string;
    department: string | null;
  }[] = [];
  if (session.role === "system_admin") {
    const listed = await app.listPersonalHandlers(sessionId);
    handlers = listed.ok ? listed.handlers : [];
  }

  const commentsResult = await app.listProductionComments(sessionId, {
    projectId,
  });
  const filesResult = await app.listProductionFiles(sessionId, { projectId });

  return {
    session,
    project: result.project,
    handlers,
    comments: commentsResult.ok ? commentsResult.comments : [],
    files: filesResult.ok ? filesResult.files : [],
  };
}

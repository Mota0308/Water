import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { Session } from "./store-work-flow-app";
import {
  HANDLER_STAGE_STATUSES,
  currentStageIndex,
  isStageDone,
  projectProgress,
  stagesForType,
  type ProductionProjectType,
  type ProductionProjectView,
  type ProductionStageView,
  type ProductionTaskView,
  type StageStatus,
} from "./production-domain";

const PROJECTS = "production_projects";
const ACCOUNTS = "accounts";

type AuthError = "unauthenticated" | "forbidden";

type StageRecord = {
  name: string;
  handlerAccountId: string | null;
  status: StageStatus;
  deadline: string | null;
  content: string;
  completedAt: Date | null;
};

type ProjectRecord = {
  _id: string;
  type: ProductionProjectType;
  code: string;
  name: string;
  category: string;
  description: string;
  ownerAccountId: string | null;
  dueDate: string | null;
  status: string;
  stages: StageRecord[];
  createdByAccountId: string;
  createdAt: Date;
  updatedAt: Date;
};

type AccountLite = {
  _id: string;
  displayName: string;
  department: string | null;
  role: string;
  status: string;
};

export type ProductionApi = {
  createProductionProject(
    actorSessionId: string,
    input: {
      type: ProductionProjectType;
      code: string;
      name: string;
      category: string;
      description?: string;
      ownerAccountId?: string;
      dueDate?: string;
      stageHandlerIds: (string | null | undefined)[];
    },
  ): Promise<
    | { ok: true; project: ProductionProjectView }
    | {
        ok: false;
        error:
          | AuthError
          | "invalid_input"
          | "invalid_handler"
          | "stage_count_mismatch";
      }
  >;
  listProductionProjects(
    sessionId: string,
    input: {
      type: ProductionProjectType;
      category?: string;
      status?: string;
      keyword?: string;
    },
  ): Promise<
    | { ok: true; projects: ProductionProjectView[] }
    | { ok: false; error: AuthError }
  >;
  getProductionProject(
    sessionId: string,
    input: { projectId: string },
  ): Promise<
    | { ok: true; project: ProductionProjectView }
    | { ok: false; error: AuthError | "not_found" }
  >;
  updateProductionStage(
    sessionId: string,
    input: {
      projectId: string;
      stageIndex: number;
      status: StageStatus;
      content?: string;
    },
  ): Promise<
    | { ok: true; project: ProductionProjectView }
    | {
        ok: false;
        error:
          | AuthError
          | "not_found"
          | "invalid_stage"
          | "not_handler"
          | "not_current_stage"
          | "invalid_status";
      }
  >;
  setProductionStageHandler(
    actorSessionId: string,
    input: {
      projectId: string;
      stageIndex: number;
      handlerAccountId: string;
    },
  ): Promise<
    | { ok: true; project: ProductionProjectView }
    | {
        ok: false;
        error: AuthError | "not_found" | "invalid_stage" | "invalid_handler";
      }
  >;
  adminResolveStage(
    actorSessionId: string,
    input: {
      projectId: string;
      stageIndex: number;
      decision: "confirm" | "return";
      note?: string;
    },
  ): Promise<
    | { ok: true; project: ProductionProjectView }
    | {
        ok: false;
        error: AuthError | "not_found" | "invalid_stage" | "not_pending_confirm";
      }
  >;
  listMyProductionTasks(
    sessionId: string,
    input?: { type?: ProductionProjectType },
  ): Promise<
    { ok: true; tasks: ProductionTaskView[] } | { ok: false; error: AuthError }
  >;
  getProductionHomeSummary(
    sessionId: string,
    input: { type: ProductionProjectType },
  ): Promise<
    | {
        ok: true;
        summary: {
          total: number;
          waitingConfirm: number;
          needFix: number;
          myTaskCount: number;
        };
      }
    | { ok: false; error: AuthError }
  >;
  listPersonalHandlers(
    actorSessionId: string,
  ): Promise<
    | {
        ok: true;
        handlers: {
          accountId: string;
          displayName: string;
          department: string | null;
        }[];
      }
    | { ok: false; error: AuthError }
  >;
};

export function createProductionApi(deps: {
  db: Db;
  now: () => Date;
  getSession: (sessionId: string) => Promise<Session | null>;
}): ProductionApi {
  const { db, now, getSession } = deps;

  async function requireSession(sessionId: string) {
    const session = await getSession(sessionId);
    if (!session) return { ok: false as const, error: "unauthenticated" as const };
    return { ok: true as const, session };
  }

  async function requireSystemAdmin(sessionId: string) {
    const auth = await requireSession(sessionId);
    if (!auth.ok) return auth;
    if (auth.session.role !== "system_admin") {
      return { ok: false as const, error: "forbidden" as const };
    }
    return auth;
  }

  async function loadAccounts(
    ids: string[],
  ): Promise<Map<string, AccountLite>> {
    if (!ids.length) return new Map();
    const rows = await db
      .collection<AccountLite>(ACCOUNTS)
      .find({ _id: { $in: ids } })
      .toArray();
    return new Map(rows.map((row) => [row._id, row]));
  }

  async function toView(project: ProjectRecord): Promise<ProductionProjectView> {
    const handlerIds = project.stages
      .map((s) => s.handlerAccountId)
      .filter((id): id is string => !!id);
    if (project.ownerAccountId) handlerIds.push(project.ownerAccountId);
    const accounts = await loadAccounts([...new Set(handlerIds)]);
    const stages: ProductionStageView[] = project.stages.map((stage, index) => {
      const handler = stage.handlerAccountId
        ? accounts.get(stage.handlerAccountId)
        : null;
      return {
        index,
        name: stage.name,
        handlerAccountId: stage.handlerAccountId,
        handlerDisplayName: handler?.displayName ?? null,
        handlerDepartment: handler?.department ?? null,
        status: stage.status,
        deadline: stage.deadline,
        content: stage.content,
        completedAt: stage.completedAt,
      };
    });
    const cur = currentStageIndex(project.stages);
    const owner = project.ownerAccountId
      ? accounts.get(project.ownerAccountId)
      : null;
    return {
      id: project._id,
      type: project.type,
      code: project.code,
      name: project.name,
      category: project.category,
      description: project.description,
      ownerAccountId: project.ownerAccountId,
      ownerDisplayName: owner?.displayName ?? null,
      dueDate: project.dueDate,
      status: project.status,
      progressPercent: projectProgress(project.stages),
      currentStageName: project.stages[cur]?.name ?? null,
      stages,
      createdAt: project.createdAt,
    };
  }

  async function getProject(id: string) {
    return db.collection<ProjectRecord>(PROJECTS).findOne({ _id: id });
  }

  async function assertPersonalHandler(accountId: string) {
    const account = await db.collection<AccountLite>(ACCOUNTS).findOne({
      _id: accountId,
    });
    if (!account || account.role !== "personal" || account.status !== "active") {
      return null;
    }
    return account;
  }

  return {
    async createProductionProject(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) return auth;

      const code = input.code.trim();
      const name = input.name.trim();
      if (!code || !name || !input.category.trim()) {
        return { ok: false, error: "invalid_input" };
      }

      const stageNames = stagesForType(input.type);
      if (input.stageHandlerIds.length !== stageNames.length) {
        return { ok: false, error: "stage_count_mismatch" };
      }

      const stages: StageRecord[] = [];
      for (let i = 0; i < stageNames.length; i += 1) {
        const handlerId = input.stageHandlerIds[i]?.trim() || null;
        if (handlerId) {
          const handler = await assertPersonalHandler(handlerId);
          if (!handler) return { ok: false, error: "invalid_handler" };
        }
        stages.push({
          name: stageNames[i]!,
          handlerAccountId: handlerId,
          status: i === 0 ? "待處理" : "未開始",
          deadline: null,
          content: "",
          completedAt: null,
        });
      }

      if (input.ownerAccountId) {
        const owner = await assertPersonalHandler(input.ownerAccountId);
        if (!owner) return { ok: false, error: "invalid_handler" };
      }

      const at = now();
      const project: ProjectRecord = {
        _id: randomUUID(),
        type: input.type,
        code,
        name,
        category: input.category.trim(),
        description: input.description?.trim() ?? "",
        ownerAccountId: input.ownerAccountId ?? null,
        dueDate: input.dueDate?.trim() || null,
        status: "進行中",
        stages,
        createdByAccountId: auth.session.accountId,
        createdAt: at,
        updatedAt: at,
      };
      await db.collection<ProjectRecord>(PROJECTS).insertOne(project);
      return { ok: true, project: await toView(project) };
    },

    async listProductionProjects(sessionId, input) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;

      const filter: Record<string, unknown> = { type: input.type };
      if (input.category && input.category !== "全部") {
        filter.category = input.category;
      }
      let projects = await db
        .collection<ProjectRecord>(PROJECTS)
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray();

      if (input.keyword?.trim()) {
        const kw = input.keyword.trim().toLowerCase();
        projects = projects.filter(
          (p) =>
            p.code.toLowerCase().includes(kw) ||
            p.name.toLowerCase().includes(kw),
        );
      }
      if (input.status && input.status !== "全部") {
        projects = projects.filter((p) => {
          const cur = p.stages[currentStageIndex(p.stages)];
          return cur?.status === input.status || p.status === input.status;
        });
      }

      return {
        ok: true,
        projects: await Promise.all(projects.map((p) => toView(p))),
      };
    },

    async getProductionProject(sessionId, input) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;
      const project = await getProject(input.projectId);
      if (!project) return { ok: false, error: "not_found" };
      return { ok: true, project: await toView(project) };
    },

    async updateProductionStage(sessionId, input) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;
      const project = await getProject(input.projectId);
      if (!project) return { ok: false, error: "not_found" };
      const stage = project.stages[input.stageIndex];
      if (!stage) return { ok: false, error: "invalid_stage" };

      const isAdmin = auth.session.role === "system_admin";
      if (!isAdmin) {
        if (auth.session.role !== "personal") {
          return { ok: false, error: "forbidden" };
        }
        if (stage.handlerAccountId !== auth.session.accountId) {
          return { ok: false, error: "not_handler" };
        }
        if (currentStageIndex(project.stages) !== input.stageIndex) {
          return { ok: false, error: "not_current_stage" };
        }
        if (!HANDLER_STAGE_STATUSES.includes(input.status)) {
          return { ok: false, error: "invalid_status" };
        }
      }

      const at = now();
      stage.status = input.status;
      if (input.content !== undefined) stage.content = input.content.trim();
      if (isStageDone(input.status)) stage.completedAt = at;
      else stage.completedAt = null;

      if (isStageDone(input.status)) {
        const next = project.stages[input.stageIndex + 1];
        if (next && next.status === "未開始") next.status = "待處理";
      }

      const allDone = project.stages.every((s) => isStageDone(s.status));
      project.status = allDone ? "已完成" : "進行中";
      project.updatedAt = at;

      await db.collection<ProjectRecord>(PROJECTS).updateOne(
        { _id: project._id },
        {
          $set: {
            stages: project.stages,
            status: project.status,
            updatedAt: at,
          },
        },
      );
      return { ok: true, project: await toView(project) };
    },

    async setProductionStageHandler(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) return auth;
      const project = await getProject(input.projectId);
      if (!project) return { ok: false, error: "not_found" };
      const stage = project.stages[input.stageIndex];
      if (!stage) return { ok: false, error: "invalid_stage" };
      const handler = await assertPersonalHandler(input.handlerAccountId);
      if (!handler) return { ok: false, error: "invalid_handler" };

      stage.handlerAccountId = input.handlerAccountId;
      project.updatedAt = now();
      await db.collection<ProjectRecord>(PROJECTS).updateOne(
        { _id: project._id },
        { $set: { stages: project.stages, updatedAt: project.updatedAt } },
      );
      return { ok: true, project: await toView(project) };
    },

    async adminResolveStage(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) return auth;
      const project = await getProject(input.projectId);
      if (!project) return { ok: false, error: "not_found" };
      const stage = project.stages[input.stageIndex];
      if (!stage) return { ok: false, error: "invalid_stage" };
      if (stage.status !== "待確認") {
        return { ok: false, error: "not_pending_confirm" };
      }

      const at = now();
      if (input.decision === "confirm") {
        stage.status = "已完成";
        stage.completedAt = at;
        if (input.note) stage.content = input.note.trim();
        const next = project.stages[input.stageIndex + 1];
        if (next && next.status === "未開始") next.status = "待處理";
      } else {
        stage.status = "需要修改";
        stage.completedAt = null;
        if (input.note) stage.content = input.note.trim();
      }

      const allDone = project.stages.every((s) => isStageDone(s.status));
      project.status = allDone ? "已完成" : "進行中";
      project.updatedAt = at;
      await db.collection<ProjectRecord>(PROJECTS).updateOne(
        { _id: project._id },
        {
          $set: {
            stages: project.stages,
            status: project.status,
            updatedAt: at,
          },
        },
      );
      return { ok: true, project: await toView(project) };
    },

    async listMyProductionTasks(sessionId, input = {}) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;
      if (auth.session.role !== "personal") {
        return { ok: true, tasks: [] };
      }

      const filter: Record<string, unknown> = {};
      if (input.type) filter.type = input.type;
      const projects = await db
        .collection<ProjectRecord>(PROJECTS)
        .find(filter)
        .toArray();

      const tasks: ProductionTaskView[] = [];
      for (const project of projects) {
        const cur = currentStageIndex(project.stages);
        const stage = project.stages[cur];
        if (!stage) continue;
        if (stage.handlerAccountId !== auth.session.accountId) continue;
        if (isStageDone(stage.status) || stage.status === "未開始") continue;
        tasks.push({
          projectId: project._id,
          projectCode: project.code,
          projectName: project.name,
          stageIndex: cur,
          stageName: stage.name,
          status: stage.status,
          deadline: stage.deadline,
          type: project.type,
        });
      }
      return { ok: true, tasks };
    },

    async getProductionHomeSummary(sessionId, input) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;
      const projects = await db
        .collection<ProjectRecord>(PROJECTS)
        .find({ type: input.type })
        .toArray();

      let waitingConfirm = 0;
      let needFix = 0;
      for (const project of projects) {
        if (project.stages.some((s) => s.status === "待確認")) waitingConfirm += 1;
        if (project.stages.some((s) => s.status === "需要修改")) needFix += 1;
      }

      let myTaskCount = 0;
      if (auth.session.role === "personal") {
        for (const project of projects) {
          const cur = currentStageIndex(project.stages);
          const stage = project.stages[cur];
          if (!stage) continue;
          if (stage.handlerAccountId !== auth.session.accountId) continue;
          if (isStageDone(stage.status) || stage.status === "未開始") continue;
          myTaskCount += 1;
        }
      }

      return {
        ok: true,
        summary: {
          total: projects.length,
          waitingConfirm,
          needFix,
          myTaskCount,
        },
      };
    },

    async listPersonalHandlers(actorSessionId) {
      const auth = await requireSession(actorSessionId);
      if (!auth.ok) return auth;
      if (
        auth.session.role !== "system_admin" &&
        auth.session.role !== "manager"
      ) {
        return { ok: false, error: "forbidden" };
      }
      const rows = await db
        .collection<AccountLite>(ACCOUNTS)
        .find({ role: "personal", status: "active" })
        .sort({ displayName: 1 })
        .toArray();
      return {
        ok: true,
        handlers: rows.map((row) => ({
          accountId: row._id,
          displayName: row.displayName,
          department: row.department,
        })),
      };
    },
  };
}

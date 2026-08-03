import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { Session } from "./store-work-flow-app";
import type { FileStorage } from "./production-file-storage";
import {
  HANDLER_STAGE_STATUSES,
  currentStageIndex,
  extractMentionNames,
  isStageDone,
  projectAllowsStageUpdates,
  projectProgress,
  stagesForType,
  toProductionCsv,
  type ProductionCommentView,
  type ProductionFileVersionView,
  type ProductionMentionView,
  type ProductionProjectType,
  type ProductionProjectView,
  type ProductionStageView,
  type ProductionTaskView,
  type StageStatus,
} from "./production-domain";

const PROJECTS = "production_projects";
const ACCOUNTS = "accounts";
const COMMENTS = "production_comments";
const FILES = "production_files";

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
  statusReason: string | null;
  stages: StageRecord[];
  createdByAccountId: string;
  createdAt: Date;
  updatedAt: Date;
};

type CommentRecord = {
  _id: string;
  projectId: string;
  authorAccountId: string;
  text: string;
  parentId: string | null;
  removed: boolean;
  removedByAccountId: string | null;
  mentionAccountIds: string[];
  createdAt: Date;
};

type FileRecord = {
  _id: string;
  projectId: string;
  logicalName: string;
  version: number;
  storageKey: string;
  fileName: string;
  contentType: string;
  size: number;
  isLatest: boolean;
  uploadedByAccountId: string;
  uploadedAt: Date;
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
  editProductionProject(
    actorSessionId: string,
    input: {
      projectId: string;
      code: string;
      name: string;
      category: string;
      description?: string;
      dueDate?: string;
    },
  ): Promise<
    | { ok: true; project: ProductionProjectView }
    | {
        ok: false;
        error: AuthError | "not_found" | "invalid_input" | "not_editable";
      }
  >;
  setProductionProjectLifecycle(
    actorSessionId: string,
    input: {
      projectId: string;
      status: "暫停" | "已取消" | "進行中";
      reason: string;
    },
  ): Promise<
    | { ok: true; project: ProductionProjectView }
    | {
        ok: false;
        error: AuthError | "not_found" | "invalid_input" | "invalid_status";
      }
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
          | "invalid_status"
          | "project_locked";
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
        error:
          | AuthError
          | "not_found"
          | "invalid_stage"
          | "invalid_handler"
          | "project_locked";
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
        error:
          | AuthError
          | "not_found"
          | "invalid_stage"
          | "not_pending_confirm"
          | "project_locked";
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
  addProductionComment(
    sessionId: string,
    input: { projectId: string; text: string; parentId?: string },
  ): Promise<
    | { ok: true; comment: ProductionCommentView }
    | {
        ok: false;
        error: AuthError | "not_found" | "invalid_input" | "invalid_parent";
      }
  >;
  listProductionComments(
    sessionId: string,
    input: { projectId: string },
  ): Promise<
    | { ok: true; comments: ProductionCommentView[] }
    | { ok: false; error: AuthError | "not_found" }
  >;
  removeProductionComment(
    actorSessionId: string,
    input: { commentId: string },
  ): Promise<
    | { ok: true }
    | { ok: false; error: AuthError | "not_found" }
  >;
  listMyMentions(
    sessionId: string,
    input?: { type?: ProductionProjectType },
  ): Promise<
    | { ok: true; mentions: ProductionMentionView[] }
    | { ok: false; error: AuthError }
  >;
  uploadProductionFile(
    sessionId: string,
    input: {
      projectId: string;
      logicalName: string;
      fileName: string;
      contentType: string;
      dataBase64: string;
    },
  ): Promise<
    | { ok: true; file: ProductionFileVersionView }
    | {
        ok: false;
        error: AuthError | "not_found" | "invalid_input" | "storage_unavailable";
      }
  >;
  listProductionFiles(
    sessionId: string,
    input: { projectId: string },
  ): Promise<
    | { ok: true; files: ProductionFileVersionView[] }
    | { ok: false; error: AuthError | "not_found" }
  >;
  getProductionFileContent(
    sessionId: string,
    input: { fileId: string },
  ): Promise<
    | {
        ok: true;
        fileName: string;
        contentType: string;
        dataBase64: string;
      }
    | { ok: false; error: AuthError | "not_found" | "storage_unavailable" }
  >;
  exportProductionProjectsCsv(
    actorSessionId: string,
    input: { type: ProductionProjectType },
  ): Promise<
    | { ok: true; csv: string }
    | { ok: false; error: AuthError }
  >;
};

export function createMemoryFileStorage(): FileStorage {
  const files = new Map<string, Buffer>();
  return {
    async save(input) {
      const storageKey = `${input.projectId}/${randomUUID()}-${input.fileName}`;
      files.set(storageKey, input.data);
      return { storageKey, size: input.data.length };
    },
    async read(storageKey) {
      const data = files.get(storageKey);
      if (!data) throw new Error("missing");
      return data;
    },
  };
}

export function createProductionApi(deps: {
  db: Db;
  now: () => Date;
  getSession: (sessionId: string) => Promise<Session | null>;
  fileStorage?: FileStorage;
}): ProductionApi {
  const { db, now, getSession } = deps;
  const fileStorage = deps.fileStorage;

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
      statusReason: project.statusReason ?? null,
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

  async function resolveMentions(text: string): Promise<string[]> {
    const names = extractMentionNames(text);
    if (!names.length) return [];
    const rows = await db
      .collection<AccountLite>(ACCOUNTS)
      .find({ displayName: { $in: names }, status: "active" })
      .toArray();
    return rows.map((r) => r._id);
  }

  async function toCommentView(
    comment: CommentRecord,
  ): Promise<ProductionCommentView> {
    const author = await db.collection<AccountLite>(ACCOUNTS).findOne({
      _id: comment.authorAccountId,
    });
    return {
      id: comment._id,
      projectId: comment.projectId,
      authorAccountId: comment.authorAccountId,
      authorDisplayName: author?.displayName ?? "未知",
      text: comment.text,
      parentId: comment.parentId,
      removed: comment.removed,
      createdAt: comment.createdAt,
      mentions: comment.mentionAccountIds,
    };
  }

  async function toFileView(file: FileRecord): Promise<ProductionFileVersionView> {
    const uploader = await db.collection<AccountLite>(ACCOUNTS).findOne({
      _id: file.uploadedByAccountId,
    });
    return {
      id: file._id,
      projectId: file.projectId,
      logicalName: file.logicalName,
      version: file.version,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
      isLatest: file.isLatest,
      uploadedByDisplayName: uploader?.displayName ?? "未知",
      uploadedAt: file.uploadedAt,
    };
  }

  async function canUpload(session: Session, project: ProjectRecord) {
    if (session.role === "system_admin") return true;
    if (session.role !== "personal") return false;
    return project.stages.some((s) => s.handlerAccountId === session.accountId);
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
        statusReason: null,
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

    async editProductionProject(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) return auth;
      const project = await getProject(input.projectId);
      if (!project) return { ok: false, error: "not_found" };
      if (project.status === "已取消") {
        return { ok: false, error: "not_editable" };
      }
      const code = input.code.trim();
      const name = input.name.trim();
      const category = input.category.trim();
      if (!code || !name || !category) {
        return { ok: false, error: "invalid_input" };
      }
      project.code = code;
      project.name = name;
      project.category = category;
      project.description = input.description?.trim() ?? "";
      project.dueDate = input.dueDate?.trim() || null;
      project.updatedAt = now();
      await db.collection<ProjectRecord>(PROJECTS).updateOne(
        { _id: project._id },
        {
          $set: {
            code: project.code,
            name: project.name,
            category: project.category,
            description: project.description,
            dueDate: project.dueDate,
            updatedAt: project.updatedAt,
          },
        },
      );
      return { ok: true, project: await toView(project) };
    },

    async setProductionProjectLifecycle(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) return auth;
      const project = await getProject(input.projectId);
      if (!project) return { ok: false, error: "not_found" };
      if (!["暫停", "已取消", "進行中"].includes(input.status)) {
        return { ok: false, error: "invalid_status" };
      }
      const reason = input.reason.trim();
      if (!reason) return { ok: false, error: "invalid_input" };
      if (project.status === "已完成" && input.status !== "進行中") {
        // allow cancel/pause of completed? skip - only active projects
      }
      project.status = input.status;
      project.statusReason = reason;
      project.updatedAt = now();
      await db.collection<ProjectRecord>(PROJECTS).updateOne(
        { _id: project._id },
        {
          $set: {
            status: project.status,
            statusReason: project.statusReason,
            updatedAt: project.updatedAt,
          },
        },
      );
      return { ok: true, project: await toView(project) };
    },

    async updateProductionStage(sessionId, input) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;
      const project = await getProject(input.projectId);
      if (!project) return { ok: false, error: "not_found" };
      if (!projectAllowsStageUpdates(project.status)) {
        return { ok: false, error: "project_locked" };
      }
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
      if (project.status !== "暫停" && project.status !== "已取消") {
        project.status = allDone ? "已完成" : "進行中";
      }
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
      if (!projectAllowsStageUpdates(project.status)) {
        return { ok: false, error: "project_locked" };
      }
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
      if (!projectAllowsStageUpdates(project.status)) {
        return { ok: false, error: "project_locked" };
      }
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

      const filter: Record<string, unknown> = {
        status: { $nin: ["暫停", "已取消"] },
      };
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
        if (!projectAllowsStageUpdates(project.status)) continue;
        if (project.stages.some((s) => s.status === "待確認")) waitingConfirm += 1;
        if (project.stages.some((s) => s.status === "需要修改")) needFix += 1;
      }

      let myTaskCount = 0;
      if (auth.session.role === "personal") {
        for (const project of projects) {
          if (!projectAllowsStageUpdates(project.status)) continue;
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

    async addProductionComment(sessionId, input) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;
      const project = await getProject(input.projectId);
      if (!project) return { ok: false, error: "not_found" };
      const text = input.text.trim();
      if (!text) return { ok: false, error: "invalid_input" };
      if (input.parentId) {
        const parent = await db.collection<CommentRecord>(COMMENTS).findOne({
          _id: input.parentId,
          projectId: project._id,
        });
        if (!parent) return { ok: false, error: "invalid_parent" };
      }
      const mentionAccountIds = await resolveMentions(text);
      const comment: CommentRecord = {
        _id: randomUUID(),
        projectId: project._id,
        authorAccountId: auth.session.accountId,
        text,
        parentId: input.parentId ?? null,
        removed: false,
        removedByAccountId: null,
        mentionAccountIds,
        createdAt: now(),
      };
      await db.collection<CommentRecord>(COMMENTS).insertOne(comment);
      return { ok: true, comment: await toCommentView(comment) };
    },

    async listProductionComments(sessionId, input) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;
      const project = await getProject(input.projectId);
      if (!project) return { ok: false, error: "not_found" };
      const rows = await db
        .collection<CommentRecord>(COMMENTS)
        .find({ projectId: project._id })
        .sort({ createdAt: 1 })
        .toArray();
      const canSeeRemoved =
        auth.session.role === "system_admin" ||
        auth.session.role === "manager";
      const visible = rows.filter((c) => canSeeRemoved || !c.removed);
      return {
        ok: true,
        comments: await Promise.all(visible.map((c) => toCommentView(c))),
      };
    },

    async removeProductionComment(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) return auth;
      const comment = await db.collection<CommentRecord>(COMMENTS).findOne({
        _id: input.commentId,
      });
      if (!comment) return { ok: false, error: "not_found" };
      await db.collection<CommentRecord>(COMMENTS).updateOne(
        { _id: comment._id },
        {
          $set: {
            removed: true,
            removedByAccountId: auth.session.accountId,
          },
        },
      );
      return { ok: true };
    },

    async listMyMentions(sessionId, input = {}) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;
      const comments = await db
        .collection<CommentRecord>(COMMENTS)
        .find({
          mentionAccountIds: auth.session.accountId,
          removed: false,
        })
        .sort({ createdAt: -1 })
        .toArray();

      const mentions: ProductionMentionView[] = [];
      for (const comment of comments) {
        const project = await getProject(comment.projectId);
        if (!project) continue;
        if (input.type && project.type !== input.type) continue;
        const author = await db.collection<AccountLite>(ACCOUNTS).findOne({
          _id: comment.authorAccountId,
        });
        mentions.push({
          commentId: comment._id,
          projectId: project._id,
          projectCode: project.code,
          projectName: project.name,
          type: project.type,
          excerpt: comment.text.slice(0, 80),
          authorDisplayName: author?.displayName ?? "未知",
          createdAt: comment.createdAt,
        });
      }
      return { ok: true, mentions };
    },

    async uploadProductionFile(sessionId, input) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;
      if (!fileStorage) return { ok: false, error: "storage_unavailable" };
      const project = await getProject(input.projectId);
      if (!project) return { ok: false, error: "not_found" };
      if (!(await canUpload(auth.session, project))) {
        return { ok: false, error: "forbidden" };
      }
      const logicalName = input.logicalName.trim() || input.fileName.trim();
      if (!logicalName || !input.fileName.trim() || !input.dataBase64) {
        return { ok: false, error: "invalid_input" };
      }
      const data = Buffer.from(input.dataBase64, "base64");
      const saved = await fileStorage.save({
        projectId: project._id,
        fileName: input.fileName.trim(),
        contentType: input.contentType || "application/octet-stream",
        data,
      });

      const latest = await db.collection<FileRecord>(FILES).findOne({
        projectId: project._id,
        logicalName,
        isLatest: true,
      });
      const version = latest ? latest.version + 1 : 1;
      if (latest) {
        await db.collection<FileRecord>(FILES).updateOne(
          { _id: latest._id },
          { $set: { isLatest: false } },
        );
      }

      const file: FileRecord = {
        _id: randomUUID(),
        projectId: project._id,
        logicalName,
        version,
        storageKey: saved.storageKey,
        fileName: input.fileName.trim(),
        contentType: input.contentType || "application/octet-stream",
        size: saved.size,
        isLatest: true,
        uploadedByAccountId: auth.session.accountId,
        uploadedAt: now(),
      };
      await db.collection<FileRecord>(FILES).insertOne(file);
      return { ok: true, file: await toFileView(file) };
    },

    async listProductionFiles(sessionId, input) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;
      const project = await getProject(input.projectId);
      if (!project) return { ok: false, error: "not_found" };
      const rows = await db
        .collection<FileRecord>(FILES)
        .find({ projectId: project._id })
        .sort({ logicalName: 1, version: -1 })
        .toArray();
      return {
        ok: true,
        files: await Promise.all(rows.map((f) => toFileView(f))),
      };
    },

    async getProductionFileContent(sessionId, input) {
      const auth = await requireSession(sessionId);
      if (!auth.ok) return auth;
      if (!fileStorage) return { ok: false, error: "storage_unavailable" };
      const file = await db.collection<FileRecord>(FILES).findOne({
        _id: input.fileId,
      });
      if (!file) return { ok: false, error: "not_found" };
      const data = await fileStorage.read(file.storageKey);
      return {
        ok: true,
        fileName: file.fileName,
        contentType: file.contentType,
        dataBase64: data.toString("base64"),
      };
    },

    async exportProductionProjectsCsv(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) return auth;
      const projects = await db
        .collection<ProjectRecord>(PROJECTS)
        .find({ type: input.type })
        .sort({ createdAt: -1 })
        .toArray();
      const views = await Promise.all(projects.map((p) => toView(p)));
      return { ok: true, csv: toProductionCsv(views) };
    },
  };
}

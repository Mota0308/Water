import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Db } from "mongodb";
import {
  createProductionApi,
  type ProductionApi,
} from "./production-api";

export type AccountRole = "personal" | "manager" | "system_admin";

export const FIXED_UNITS = [
  "觀塘",
  "荔枝角",
  "灣仔",
  "屯門",
  "國內倉",
] as const;

export type FixedUnit = (typeof FIXED_UNITS)[number];

export const STORE_UNITS = ["觀塘", "荔枝角", "灣仔", "屯門"] as const;
export type StoreUnit = (typeof STORE_UNITS)[number];
export type SettlementState = "awaiting_part2" | null;
export type AttachmentRequirement = "none" | "optional" | "required";
export type NoteRequirement = "optional" | "required";

export type WorkAttachmentInput = {
  fileName: string;
  contentType: string;
  dataBase64: string;
};

export type WorkAttachmentView = {
  id: string;
  workId: string;
  fileName: string;
  contentType: string;
  dataBase64: string;
  uploadedByDisplayName: string;
  uploadedAt: Date;
};

export type CompletionHistoryView = {
  id: string;
  workId: string;
  completedByAccountId: string | null;
  completedByDisplayName: string | null;
  completedAt: Date | null;
  completionNote: string | null;
  reopenedAt: Date;
  reopenedByDisplayName: string;
  reason: string;
};

export type WorkChangeLogView = {
  id: string;
  workId: string;
  field: string;
  before: string;
  after: string;
  changedByDisplayName: string;
  changedAt: Date;
};

export type StaffStatView = {
  accountId: string;
  displayName: string;
  completedCount: number;
  overdueCompletedCount: number;
};

const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export type Session = {
  sessionId: string;
  accountId: string;
  loginName: string;
  displayName: string;
  role: AccountRole;
  fixedUnit: FixedUnit | null;
};

export type AccountView = {
  id: string;
  loginName: string;
  displayName: string;
  role: AccountRole;
  fixedUnit: FixedUnit | null;
  jobTitle: string | null;
  department: string | null;
  status: "active" | "suspended";
  lastLoginAt: Date | null;
};

export type UnitChangeLogView = {
  id: string;
  accountId: string;
  fromUnit: FixedUnit | null;
  toUnit: FixedUnit;
  reason: string | null;
  changedByAccountId: string;
  changedByLoginName: string;
  changedAt: Date;
};

export type WorkPriority = "normal" | "important" | "urgent";
export type WorkStatus = "pending" | "completed" | "cancelled";
export type WorkType = "adhoc" | "recurring" | "daily_settlement";
export type Recurrence = "daily" | "weekdays";

export type WorkView = {
  id: string;
  type: WorkType;
  title: string;
  content: string;
  unit: FixedUnit;
  priority: WorkPriority;
  status: WorkStatus;
  startAt: Date | null;
  dueAt: Date | null;
  templateId: string | null;
  settlementState: SettlementState;
  attachmentRequirement: AttachmentRequirement;
  noteRequirement: NoteRequirement;
  completionNote: string | null;
  sensitive: boolean;
  completedByAccountId: string | null;
  completedByDisplayName: string | null;
  completedAt: Date | null;
};

export type RecurringTemplateView = {
  id: string;
  title: string;
  content: string;
  units: FixedUnit[];
  priority: WorkPriority;
  recurrence: Recurrence;
  sortOrder: number;
  active: boolean;
  attachmentRequirement: AttachmentRequirement;
  noteRequirement: NoteRequirement;
  sensitive: boolean;
};

export type TodayWorkSummary = {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  percent: number;
};

export type WorkAuditView = {
  id: string;
  workId: string;
  action: "complete" | "cancel_completion" | "reopen";
  actorAccountId: string;
  actorDisplayName: string;
  fromStatus: WorkStatus;
  toStatus: WorkStatus;
  at: Date;
  reason?: string | null;
};

export type UnitProgressView = TodayWorkSummary & {
  unit: FixedUnit;
};

export type MyCompletionView = {
  id: string;
  title: string;
  unit: FixedUnit;
  completedAt: Date;
  dueAt: Date | null;
  onTime: boolean;
};

export type ReadonlyWorkView = {
  id: string;
  type: WorkType;
  title: string;
  unit: FixedUnit;
  priority: WorkPriority;
  status: WorkStatus;
  dueAt: Date | null;
  completedByDisplayName: string | null;
  completedAt: Date | null;
  lastUpdatedAt: Date;
};

export const CROSS_UNIT_READONLY_NOTICE =
  "你正在查看其他單位的工作進度，此頁面只供查看，不可修改。";

type AccountRecord = {
  _id: string;
  loginName: string;
  displayName: string;
  passwordHash: string;
  role: AccountRole;
  fixedUnit: FixedUnit | null;
  jobTitle: string | null;
  department: string | null;
  status: "active" | "suspended";
  createdAt: Date;
  lastLoginAt: Date | null;
};

type SessionRecord = {
  _id: string;
  accountId: string;
  createdAt: Date;
  lastSeenAt: Date;
};

type UnitChangeLogRecord = {
  _id: string;
  accountId: string;
  fromUnit: FixedUnit | null;
  toUnit: FixedUnit;
  reason: string | null;
  changedByAccountId: string;
  changedByLoginName: string;
  changedAt: Date;
};

type WorkRecord = {
  _id: string;
  type: WorkType;
  title: string;
  content: string;
  unit: FixedUnit;
  priority: WorkPriority;
  status: WorkStatus;
  startAt: Date | null;
  dueAt: Date | null;
  templateId: string | null;
  settlementState: SettlementState;
  attachmentRequirement: AttachmentRequirement;
  noteRequirement: NoteRequirement;
  completionNote: string | null;
  sensitive: boolean;
  completedByAccountId: string | null;
  completedByDisplayName: string | null;
  completedAt: Date | null;
  createdByAccountId: string;
  createdAt: Date;
  updatedAt: Date;
};

type AttachmentRecord = {
  _id: string;
  workId: string;
  fileName: string;
  contentType: string;
  dataBase64: string;
  uploadedByAccountId: string;
  uploadedByDisplayName: string;
  uploadedAt: Date;
};

type CompletionHistoryRecord = {
  _id: string;
  workId: string;
  completedByAccountId: string | null;
  completedByDisplayName: string | null;
  completedAt: Date | null;
  completionNote: string | null;
  reopenedAt: Date;
  reopenedByAccountId: string;
  reopenedByDisplayName: string;
  reason: string;
};

type WorkChangeLogRecord = {
  _id: string;
  workId: string;
  field: string;
  before: string;
  after: string;
  changedByAccountId: string;
  changedByDisplayName: string;
  changedAt: Date;
};

type RecurringTemplateRecord = {
  _id: string;
  title: string;
  content: string;
  units: FixedUnit[];
  priority: WorkPriority;
  recurrence: Recurrence;
  sortOrder: number;
  active: boolean;
  attachmentRequirement: AttachmentRequirement;
  noteRequirement: NoteRequirement;
  sensitive: boolean;
  createdByAccountId: string;
  createdAt: Date;
  updatedAt: Date;
};

type WorkAuditRecord = {
  _id: string;
  workId: string;
  action: "complete" | "cancel_completion" | "reopen";
  actorAccountId: string;
  actorDisplayName: string;
  fromStatus: WorkStatus;
  toStatus: WorkStatus;
  at: Date;
  reason?: string | null;
};

type AuthError = "unauthenticated" | "forbidden";

export type StoreWorkFlowApp = {
  seedSystemAdmin(input: {
    loginName: string;
    password: string;
    displayName: string;
  }): Promise<void>;
  login(input: {
    loginName: string;
    password: string;
  }): Promise<
    { ok: true; sessionId: string } | { ok: false; error: "invalid_credentials" }
  >;
  logout(sessionId: string): Promise<void>;
  getSession(sessionId: string): Promise<Session | null>;
  requireSession(
    sessionId: string | null | undefined,
  ): Promise<
    { ok: true; session: Session } | { ok: false; error: "unauthenticated" }
  >;
  createAccount(
    actorSessionId: string,
    input: {
      loginName: string;
      password: string;
      displayName: string;
      role: AccountRole;
      fixedUnit?: FixedUnit;
      jobTitle?: string;
      department?: string;
    },
  ): Promise<
    | { ok: true; account: AccountView }
    | {
        ok: false;
        error:
          | AuthError
          | "invalid_unit"
          | "fixed_unit_required"
          | "login_name_taken";
      }
  >;
  listAccounts(
    actorSessionId: string,
  ): Promise<
    { ok: true; accounts: AccountView[] } | { ok: false; error: AuthError }
  >;
  changeOwnPassword(
    sessionId: string,
    input: { oldPassword: string; newPassword: string },
  ): Promise<
    | { ok: true }
    | { ok: false; error: "unauthenticated" | "invalid_credentials" }
  >;
  resetPassword(
    actorSessionId: string,
    input: { accountId: string; newPassword: string },
  ): Promise<{ ok: true } | { ok: false; error: AuthError | "not_found" }>;
  setAccountStatus(
    actorSessionId: string,
    input: { accountId: string; status: "active" | "suspended" },
  ): Promise<{ ok: true } | { ok: false; error: AuthError | "not_found" }>;
  changeFixedUnit(
    actorSessionId: string,
    input: { accountId: string; fixedUnit: FixedUnit; reason?: string },
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        error: AuthError | "not_found" | "invalid_unit" | "not_personal";
      }
  >;
  listUnitChangeLogs(
    actorSessionId: string,
    input: { accountId: string },
  ): Promise<
    | { ok: true; logs: UnitChangeLogView[] }
    | { ok: false; error: AuthError }
  >;
  createAdhocWork(
    actorSessionId: string,
    input: {
      title: string;
      content: string;
      units: FixedUnit[];
      priority: WorkPriority;
      startAt?: Date;
      dueAt?: Date;
      attachmentRequirement?: AttachmentRequirement;
      noteRequirement?: NoteRequirement;
      sensitive?: boolean;
    },
  ): Promise<
    | { ok: true; works: WorkView[] }
    | { ok: false; error: AuthError | "invalid_unit" | "units_required" }
  >;
  getTodayWork(
    sessionId: string,
  ): Promise<
    | { ok: true; works: WorkView[]; summary: TodayWorkSummary }
    | { ok: false; error: AuthError | "fixed_unit_required" }
  >;
  completeWork(
    sessionId: string,
    input: {
      workId: string;
      note?: string;
      attachments?: WorkAttachmentInput[];
    },
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        error:
          | AuthError
          | "not_found"
          | "already_completed"
          | "fixed_unit_required"
          | "reserved_for_part2"
          | "attachment_required"
          | "note_required"
          | "invalid_attachment_type";
      }
  >;
  getWork(
    sessionId: string,
    input: { workId: string },
  ): Promise<
    | { ok: true; work: WorkView }
    | { ok: false; error: AuthError | "not_found" }
  >;
  listWorkAttachments(
    sessionId: string,
    input: { workId: string },
  ): Promise<
    | { ok: true; attachments: WorkAttachmentView[] }
    | { ok: false; error: AuthError | "not_found" }
  >;
  listCompletionHistory(
    actorSessionId: string,
    input: { workId: string },
  ): Promise<
    | { ok: true; history: CompletionHistoryView[] }
    | { ok: false; error: AuthError }
  >;
  reopenWork(
    actorSessionId: string,
    input: { workId: string; reason: string },
  ): Promise<
    | { ok: true }
    | { ok: false; error: AuthError | "not_found" | "not_completed" }
  >;
  updateWork(
    actorSessionId: string,
    input: {
      workId: string;
      title?: string;
      content?: string;
      priority?: WorkPriority;
      attachmentRequirement?: AttachmentRequirement;
      noteRequirement?: NoteRequirement;
      sensitive?: boolean;
    },
  ): Promise<{ ok: true } | { ok: false; error: AuthError | "not_found" }>;
  cancelAdhocWork(
    actorSessionId: string,
    input: { workId: string },
  ): Promise<
    | { ok: true }
    | { ok: false; error: AuthError | "not_found" | "not_adhoc" }
  >;
  listRecurringTemplates(
    actorSessionId: string,
  ): Promise<
    | { ok: true; templates: RecurringTemplateView[] }
    | { ok: false; error: AuthError }
  >;
  deactivateRecurringTemplate(
    actorSessionId: string,
    input: { templateId: string },
  ): Promise<{ ok: true } | { ok: false; error: AuthError | "not_found" }>;
  listWorkChangeLogs(
    actorSessionId: string,
    input: { workId: string },
  ): Promise<
    | { ok: true; logs: WorkChangeLogView[] }
    | { ok: false; error: AuthError }
  >;
  listMyCompletions(
    sessionId: string,
    input?: { from?: Date; to?: Date },
  ): Promise<
    | { ok: true; completions: MyCompletionView[] }
    | { ok: false; error: AuthError }
  >;
  searchWorkHistory(
    actorSessionId: string,
    input: {
      unit?: FixedUnit;
      status?: WorkStatus;
      priority?: WorkPriority;
      type?: WorkType;
      accountId?: string;
      from?: Date;
      to?: Date;
      overdueOnly?: boolean;
    },
  ): Promise<
    { ok: true; works: WorkView[] } | { ok: false; error: AuthError }
  >;
  getStaffStats(
    actorSessionId: string,
    input: { unit?: FixedUnit; from?: Date; to?: Date },
  ): Promise<
    { ok: true; stats: StaffStatView[] } | { ok: false; error: AuthError }
  >;
  exportWorkHistoryCsv(
    actorSessionId: string,
    input: {
      unit?: FixedUnit;
      status?: WorkStatus;
      priority?: WorkPriority;
      type?: WorkType;
      overdueOnly?: boolean;
    },
  ): Promise<{ ok: true; csv: string } | { ok: false; error: AuthError }>;
  seedDemoRecurringTemplates(
    actorSessionId: string,
  ): Promise<
    { ok: true; createdCount: number } | { ok: false; error: AuthError }
  >;
  cancelOwnCompletion(
    sessionId: string,
    input: { workId: string },
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        error:
          | AuthError
          | "not_found"
          | "not_completer"
          | "not_completed"
          | "fixed_unit_required"
          | "reserved_for_part2";
      }
  >;
  listWorkAudit(
    actorSessionId: string,
    input: { workId: string },
  ): Promise<
    | { ok: true; entries: WorkAuditView[] }
    | { ok: false; error: AuthError }
  >;
  createRecurringTemplate(
    actorSessionId: string,
    input: {
      title: string;
      content: string;
      units: FixedUnit[];
      priority: WorkPriority;
      recurrence: Recurrence;
      sortOrder?: number;
      attachmentRequirement?: AttachmentRequirement;
      noteRequirement?: NoteRequirement;
      sensitive?: boolean;
    },
  ): Promise<
    | { ok: true; template: RecurringTemplateView }
    | { ok: false; error: AuthError | "invalid_unit" | "units_required" }
  >;
  generateRecurringForDate(
    actorSessionId: string,
    input: { date: Date },
  ): Promise<
    { ok: true; createdCount: number } | { ok: false; error: AuthError }
  >;
  createDailySettlementWork(
    actorSessionId: string,
    input: {
      title: string;
      content: string;
      priority: WorkPriority;
    },
  ): Promise<
    { ok: true; works: WorkView[] } | { ok: false; error: AuthError }
  >;
  listUnitProgress(
    sessionId: string,
  ): Promise<
    | {
        ok: true;
        units: UnitProgressView[];
        readOnlyNotice: string;
      }
    | { ok: false; error: AuthError }
  >;
  getUnitWorkReadonly(
    sessionId: string,
    input: { unit: FixedUnit },
  ): Promise<
    | {
        ok: true;
        unit: FixedUnit;
        works: ReadonlyWorkView[];
        summary: TodayWorkSummary;
        readOnlyNotice: string;
      }
    | { ok: false; error: AuthError | "invalid_unit" }
  >;
} & ProductionApi;

const ACCOUNTS = "accounts";
const SESSIONS = "sessions";
const UNIT_CHANGE_LOGS = "unit_change_logs";
const WORKS = "work_instances";
const WORK_AUDITS = "work_audits";
const RECURRING_TEMPLATES = "recurring_templates";
const WORK_ATTACHMENTS = "work_attachments";
const WORK_CHANGE_LOGS = "work_change_logs";
const COMPLETION_HISTORY = "work_completion_history";

function isFixedUnit(value: string): value is FixedUnit {
  return (FIXED_UNITS as readonly string[]).includes(value);
}

function toAccountView(account: AccountRecord): AccountView {
  return {
    id: account._id,
    loginName: account.loginName,
    displayName: account.displayName,
    role: account.role,
    fixedUnit: account.fixedUnit,
    jobTitle: account.jobTitle,
    department: account.department,
    status: account.status,
    lastLoginAt: account.lastLoginAt,
  };
}

function toWorkView(work: WorkRecord): WorkView {
  return {
    id: work._id,
    type: work.type,
    title: work.title,
    content: work.content,
    unit: work.unit,
    priority: work.priority,
    status: work.status,
    startAt: work.startAt,
    dueAt: work.dueAt,
    templateId: work.templateId,
    settlementState: work.settlementState ?? null,
    attachmentRequirement: work.attachmentRequirement ?? "none",
    noteRequirement: work.noteRequirement ?? "optional",
    completionNote: work.completionNote ?? null,
    sensitive: work.sensitive ?? false,
    completedByAccountId: work.completedByAccountId,
    completedByDisplayName: work.completedByDisplayName,
    completedAt: work.completedAt,
  };
}

function sortTodayWorks(works: WorkView[], asOf: Date): WorkView[] {
  const rank = (work: WorkView): number => {
    if (work.status === "completed") return 90;
    const overdue =
      work.dueAt !== null && work.dueAt.getTime() < asOf.getTime();
    if (overdue) return 0;
    if (work.priority === "urgent") return 1;
    if (work.priority === "important") return 2;
    if (work.dueAt) return 3;
    if (work.type === "adhoc") return 4;
    if (work.type === "recurring") return 5;
    return 6;
  };
  return [...works].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return a.title.localeCompare(b.title, "zh-Hant");
  });
}

function toTemplateView(template: RecurringTemplateRecord): RecurringTemplateView {
  return {
    id: template._id,
    title: template.title,
    content: template.content,
    units: template.units,
    priority: template.priority,
    recurrence: template.recurrence,
    sortOrder: template.sortOrder,
    active: template.active,
    attachmentRequirement: template.attachmentRequirement ?? "none",
    noteRequirement: template.noteRequirement ?? "optional",
    sensitive: template.sensitive ?? false,
  };
}

function hongKongDateKey(date: Date): string {
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Hong_Kong" }).slice(0, 10);
}

function dueAtOnHongKongDate(date: Date): Date {
  const key = hongKongDateKey(date);
  return new Date(`${key}T18:00:00+08:00`);
}

function recurrenceMatches(recurrence: Recurrence, date: Date): boolean {
  if (recurrence === "daily") {
    return true;
  }
  const weekday = new Date(
    date.toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" }),
  ).getDay();
  return weekday >= 1 && weekday <= 5;
}

function summarizeWorks(
  works: WorkView[],
  asOf: Date = new Date(),
): TodayWorkSummary {
  const total = works.length;
  const completed = works.filter((work) => work.status === "completed").length;
  const pending = works.filter((work) => work.status === "pending").length;
  const asOfMs = asOf.getTime();
  const overdue = works.filter(
    (work) =>
      work.status === "pending" &&
      work.dueAt !== null &&
      work.dueAt.getTime() < asOfMs,
  ).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { total, completed, pending, overdue, percent };
}

export function createStoreWorkFlowApp(deps: {
  db: Db;
  now?: () => Date;
  idleTimeoutMs?: number;
}): StoreWorkFlowApp {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const idleTimeoutMs = deps.idleTimeoutMs ?? 30 * 60 * 1000;

  async function getSession(sessionId: string): Promise<Session | null> {
    const session = await db
      .collection<SessionRecord>(SESSIONS)
      .findOne({ _id: sessionId });
    if (!session) {
      return null;
    }

    const lastSeen = session.lastSeenAt ?? session.createdAt;
    if (now().getTime() - lastSeen.getTime() > idleTimeoutMs) {
      await db.collection<SessionRecord>(SESSIONS).deleteOne({ _id: sessionId });
      return null;
    }

    const account = await db
      .collection<AccountRecord>(ACCOUNTS)
      .findOne({ _id: session.accountId });
    if (!account || account.status !== "active") {
      return null;
    }

    await db.collection<SessionRecord>(SESSIONS).updateOne(
      { _id: sessionId },
      { $set: { lastSeenAt: now() } },
    );

    return {
      sessionId: session._id,
      accountId: account._id,
      loginName: account.loginName,
      displayName: account.displayName,
      role: account.role,
      fixedUnit: account.fixedUnit,
    };
  }

  async function requireSystemAdmin(sessionId: string) {
    const session = await getSession(sessionId);
    if (!session) {
      return { ok: false as const, error: "unauthenticated" as const };
    }
    if (session.role !== "system_admin") {
      return { ok: false as const, error: "forbidden" as const };
    }
    return { ok: true as const, session };
  }

  async function requireManager(sessionId: string) {
    const session = await getSession(sessionId);
    if (!session) {
      return { ok: false as const, error: "unauthenticated" as const };
    }
    if (session.role !== "manager" && session.role !== "system_admin") {
      return { ok: false as const, error: "forbidden" as const };
    }
    return { ok: true as const, session };
  }

  async function appendWorkAudit(entry: Omit<WorkAuditRecord, "_id">) {
    await db.collection<WorkAuditRecord>(WORK_AUDITS).insertOne({
      _id: randomUUID(),
      reason: null,
      ...entry,
    });
  }

  async function searchWorkHistoryInternal(input: {
    unit?: FixedUnit;
    status?: WorkStatus;
    priority?: WorkPriority;
    type?: WorkType;
    accountId?: string;
    from?: Date;
    to?: Date;
    overdueOnly?: boolean;
  }): Promise<WorkView[]> {
    const filter: Record<string, unknown> = {
      status: { $ne: "cancelled" },
    };
    if (input.unit) filter.unit = input.unit;
    if (input.status) filter.status = input.status;
    if (input.priority) filter.priority = input.priority;
    if (input.type) filter.type = input.type;
    if (input.accountId) filter.completedByAccountId = input.accountId;
    if (input.from || input.to) {
      filter.createdAt = {
        ...(input.from ? { $gte: input.from } : {}),
        ...(input.to ? { $lte: input.to } : {}),
      };
    }
    let works = await db
      .collection<WorkRecord>(WORKS)
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();
    if (input.overdueOnly) {
      const asOf = now().getTime();
      works = works.filter((work) => {
        if (!work.dueAt) return false;
        if (work.status === "pending") return work.dueAt.getTime() < asOf;
        if (work.status === "completed" && work.completedAt) {
          return work.completedAt.getTime() > work.dueAt.getTime();
        }
        return false;
      });
    }
    return works.map(toWorkView);
  }

  async function listTodayWorkRecords(options?: {
    unit?: FixedUnit;
    hideSensitiveFor?: Session | null;
  }): Promise<WorkRecord[]> {
    const today = now();
    await generateRecurringForDateInternal(today);
    const todayKey = hongKongDateKey(today);
    const filter: Record<string, unknown> = {
      status: { $in: ["pending", "completed"] },
      type: { $in: ["adhoc", "recurring", "daily_settlement"] },
    };
    if (options?.unit) {
      filter.unit = options.unit;
    }

    return (
      await db
        .collection<WorkRecord>(WORKS)
        .find(filter)
        .sort({ dueAt: 1, createdAt: 1 })
        .toArray()
    ).filter((work) => {
      if (work.status === "cancelled") return false;
      if (work.status === "pending" || (work.status === "completed" && work.completedAt && hongKongDateKey(work.completedAt) === todayKey)) {
        if (
          work.sensitive &&
          options?.hideSensitiveFor?.role === "personal" &&
          options.hideSensitiveFor.fixedUnit !== work.unit
        ) {
          return false;
        }
        return true;
      }
      return false;
    });
  }

  function toReadonlyWorkView(work: WorkRecord): ReadonlyWorkView {
    return {
      id: work._id,
      type: work.type,
      title: work.title,
      unit: work.unit,
      priority: work.priority,
      status: work.status,
      dueAt: work.dueAt,
      completedByDisplayName: work.completedByDisplayName,
      completedAt: work.completedAt,
      lastUpdatedAt: work.updatedAt ?? work.completedAt ?? work.createdAt,
    };
  }

  async function generateRecurringForDateInternal(date: Date): Promise<number> {
    const templates = await db
      .collection<RecurringTemplateRecord>(RECURRING_TEMPLATES)
      .find({ active: true })
      .toArray();

    let createdCount = 0;
    for (const template of templates) {
      if (!recurrenceMatches(template.recurrence, date)) {
        continue;
      }

      for (const unit of template.units) {
        const open = await db.collection<WorkRecord>(WORKS).findOne({
          templateId: template._id,
          unit,
          status: "pending",
        });
        if (open) {
          continue;
        }

        const work: WorkRecord = {
          _id: randomUUID(),
          type: "recurring",
          title: template.title,
          content: template.content,
          unit,
          priority: template.priority,
          status: "pending",
          startAt: date,
          dueAt: dueAtOnHongKongDate(date),
          templateId: template._id,
          settlementState: null,
          attachmentRequirement: template.attachmentRequirement ?? "none",
          noteRequirement: template.noteRequirement ?? "optional",
          completionNote: null,
          sensitive: template.sensitive ?? false,
          completedByAccountId: null,
          completedByDisplayName: null,
          completedAt: null,
          createdByAccountId: template.createdByAccountId,
          createdAt: now(),
          updatedAt: now(),
        };
        await db.collection<WorkRecord>(WORKS).insertOne(work);
        createdCount += 1;
      }
    }

    return createdCount;
  }

  const productionApi = createProductionApi({ db, now, getSession });

  return {
    ...productionApi,
    async seedSystemAdmin(input) {
      await db.collection(ACCOUNTS).createIndex({ loginName: 1 }, { unique: true });

      const existing = await db.collection<AccountRecord>(ACCOUNTS).findOne({
        loginName: input.loginName,
      });
      if (existing) {
        return;
      }

      const passwordHash = await bcrypt.hash(input.password, 10);
      const account: AccountRecord = {
        _id: randomUUID(),
        loginName: input.loginName,
        displayName: input.displayName,
        passwordHash,
        role: "system_admin",
        fixedUnit: null,
        jobTitle: null,
        department: null,
        status: "active",
        createdAt: new Date(),
        lastLoginAt: null,
      };
      await db.collection<AccountRecord>(ACCOUNTS).insertOne(account);
    },

    async login(input) {
      const account = await db.collection<AccountRecord>(ACCOUNTS).findOne({
        loginName: input.loginName,
      });

      if (!account || account.status !== "active") {
        return { ok: false, error: "invalid_credentials" };
      }

      const passwordMatches = await bcrypt.compare(
        input.password,
        account.passwordHash,
      );
      if (!passwordMatches) {
        return { ok: false, error: "invalid_credentials" };
      }

      const sessionId = randomUUID();
      const createdAt = now();
      const session: SessionRecord = {
        _id: sessionId,
        accountId: account._id,
        createdAt,
        lastSeenAt: createdAt,
      };
      await db.collection<SessionRecord>(SESSIONS).insertOne(session);
      await db.collection<AccountRecord>(ACCOUNTS).updateOne(
        { _id: account._id },
        { $set: { lastLoginAt: new Date() } },
      );

      return { ok: true, sessionId };
    },

    async logout(sessionId) {
      await db.collection<SessionRecord>(SESSIONS).deleteOne({ _id: sessionId });
    },

    getSession,

    async requireSession(sessionId) {
      if (!sessionId) {
        return { ok: false, error: "unauthenticated" };
      }

      const session = await getSession(sessionId);
      if (!session) {
        return { ok: false, error: "unauthenticated" };
      }

      return { ok: true, session };
    },

    async createAccount(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) {
        return auth;
      }

      if (input.role === "personal") {
        if (!input.fixedUnit) {
          return { ok: false, error: "fixed_unit_required" };
        }
        if (!isFixedUnit(input.fixedUnit)) {
          return { ok: false, error: "invalid_unit" };
        }
      } else if (input.fixedUnit !== undefined && !isFixedUnit(input.fixedUnit)) {
        return { ok: false, error: "invalid_unit" };
      }

      const existing = await db.collection<AccountRecord>(ACCOUNTS).findOne({
        loginName: input.loginName,
      });
      if (existing) {
        return { ok: false, error: "login_name_taken" };
      }

      const account: AccountRecord = {
        _id: randomUUID(),
        loginName: input.loginName,
        displayName: input.displayName,
        passwordHash: await bcrypt.hash(input.password, 10),
        role: input.role,
        fixedUnit: input.role === "personal" ? (input.fixedUnit ?? null) : null,
        jobTitle: input.jobTitle?.trim() || null,
        department: input.department?.trim() || null,
        status: "active",
        createdAt: new Date(),
        lastLoginAt: null,
      };

      await db.collection<AccountRecord>(ACCOUNTS).insertOne(account);
      return { ok: true, account: toAccountView(account) };
    },

    async listAccounts(actorSessionId) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) {
        return auth;
      }

      const accounts = await db
        .collection<AccountRecord>(ACCOUNTS)
        .find({})
        .sort({ createdAt: 1 })
        .toArray();

      return { ok: true, accounts: accounts.map(toAccountView) };
    },

    async changeOwnPassword(sessionId, input) {
      const session = await getSession(sessionId);
      if (!session) {
        return { ok: false, error: "unauthenticated" };
      }

      const account = await db
        .collection<AccountRecord>(ACCOUNTS)
        .findOne({ _id: session.accountId });
      if (!account) {
        return { ok: false, error: "unauthenticated" };
      }

      const matches = await bcrypt.compare(input.oldPassword, account.passwordHash);
      if (!matches) {
        return { ok: false, error: "invalid_credentials" };
      }

      await db.collection<AccountRecord>(ACCOUNTS).updateOne(
        { _id: account._id },
        { $set: { passwordHash: await bcrypt.hash(input.newPassword, 10) } },
      );

      return { ok: true };
    },

    async resetPassword(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) {
        return auth;
      }

      const account = await db
        .collection<AccountRecord>(ACCOUNTS)
        .findOne({ _id: input.accountId });
      if (!account) {
        return { ok: false, error: "not_found" };
      }

      await db.collection<AccountRecord>(ACCOUNTS).updateOne(
        { _id: account._id },
        { $set: { passwordHash: await bcrypt.hash(input.newPassword, 10) } },
      );

      return { ok: true };
    },

    async setAccountStatus(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) {
        return auth;
      }

      const result = await db.collection<AccountRecord>(ACCOUNTS).updateOne(
        { _id: input.accountId },
        { $set: { status: input.status } },
      );
      if (result.matchedCount === 0) {
        return { ok: false, error: "not_found" };
      }

      if (input.status === "suspended") {
        await db
          .collection<SessionRecord>(SESSIONS)
          .deleteMany({ accountId: input.accountId });
      }

      return { ok: true };
    },

    async changeFixedUnit(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) {
        return auth;
      }

      if (!isFixedUnit(input.fixedUnit)) {
        return { ok: false, error: "invalid_unit" };
      }

      const account = await db
        .collection<AccountRecord>(ACCOUNTS)
        .findOne({ _id: input.accountId });
      if (!account) {
        return { ok: false, error: "not_found" };
      }
      if (account.role !== "personal") {
        return { ok: false, error: "not_personal" };
      }

      const fromUnit = account.fixedUnit;
      await db.collection<AccountRecord>(ACCOUNTS).updateOne(
        { _id: account._id },
        { $set: { fixedUnit: input.fixedUnit } },
      );

      const log: UnitChangeLogRecord = {
        _id: randomUUID(),
        accountId: account._id,
        fromUnit,
        toUnit: input.fixedUnit,
        reason: input.reason?.trim() || null,
        changedByAccountId: auth.session.accountId,
        changedByLoginName: auth.session.loginName,
        changedAt: new Date(),
      };
      await db.collection<UnitChangeLogRecord>(UNIT_CHANGE_LOGS).insertOne(log);

      return { ok: true };
    },

    async listUnitChangeLogs(actorSessionId, input) {
      const auth = await requireSystemAdmin(actorSessionId);
      if (!auth.ok) {
        return auth;
      }

      const logs = await db
        .collection<UnitChangeLogRecord>(UNIT_CHANGE_LOGS)
        .find({ accountId: input.accountId })
        .sort({ changedAt: -1 })
        .toArray();

      return {
        ok: true,
        logs: logs.map((log) => ({
          id: log._id,
          accountId: log.accountId,
          fromUnit: log.fromUnit,
          toUnit: log.toUnit,
          reason: log.reason,
          changedByAccountId: log.changedByAccountId,
          changedByLoginName: log.changedByLoginName,
          changedAt: log.changedAt,
        })),
      };
    },

    async createAdhocWork(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) {
        return auth;
      }

      if (!input.units.length) {
        return { ok: false, error: "units_required" };
      }
      if (input.units.some((unit) => !isFixedUnit(unit))) {
        return { ok: false, error: "invalid_unit" };
      }

      const uniqueUnits = [...new Set(input.units)];
      const works: WorkRecord[] = uniqueUnits.map((unit) => ({
        _id: randomUUID(),
        type: "adhoc",
        title: input.title.trim(),
        content: input.content.trim(),
        unit,
        priority: input.priority,
        status: "pending",
        startAt: input.startAt ?? null,
        dueAt: input.dueAt ?? null,
        templateId: null,
        settlementState: null,
        attachmentRequirement: input.attachmentRequirement ?? "none",
        noteRequirement: input.noteRequirement ?? "optional",
        completionNote: null,
        sensitive: input.sensitive ?? false,
        completedByAccountId: null,
        completedByDisplayName: null,
        completedAt: null,
        createdByAccountId: auth.session.accountId,
        createdAt: now(),
        updatedAt: now(),
      }));

      if (works.length) {
        await db.collection<WorkRecord>(WORKS).insertMany(works);
      }

      return { ok: true, works: works.map(toWorkView) };
    },

    async getTodayWork(sessionId) {
      const session = await getSession(sessionId);
      if (!session) {
        return { ok: false, error: "unauthenticated" };
      }

      const today = now();

      if (session.role === "personal") {
        if (!session.fixedUnit) {
          return { ok: false, error: "fixed_unit_required" };
        }

        const works = sortTodayWorks(
          (
            await listTodayWorkRecords({
              unit: session.fixedUnit,
              hideSensitiveFor: null,
            })
          ).map(toWorkView),
          today,
        );
        return { ok: true, works, summary: summarizeWorks(works, today) };
      }

      const works = sortTodayWorks(
        (await listTodayWorkRecords()).map(toWorkView),
        today,
      );
      return { ok: true, works, summary: summarizeWorks(works, today) };
    },

    async completeWork(sessionId, input) {
      const session = await getSession(sessionId);
      if (!session) {
        return { ok: false, error: "unauthenticated" };
      }
      if (session.role === "personal" && !session.fixedUnit) {
        return { ok: false, error: "fixed_unit_required" };
      }

      const work = await db
        .collection<WorkRecord>(WORKS)
        .findOne({ _id: input.workId });
      if (!work || work.status === "cancelled") {
        return { ok: false, error: "not_found" };
      }
      if (session.role === "personal" && work.unit !== session.fixedUnit) {
        return { ok: false, error: "forbidden" };
      }
      if (work.type === "daily_settlement") {
        return { ok: false, error: "reserved_for_part2" };
      }
      if (work.status === "completed") {
        return { ok: false, error: "already_completed" };
      }

      const attachments = input.attachments ?? [];
      const requirement = work.attachmentRequirement ?? "none";
      if (requirement === "required" && attachments.length === 0) {
        return { ok: false, error: "attachment_required" };
      }
      if (
        attachments.some(
          (file) => !ALLOWED_ATTACHMENT_TYPES.has(file.contentType),
        )
      ) {
        return { ok: false, error: "invalid_attachment_type" };
      }

      const noteRequirement = work.noteRequirement ?? "optional";
      const note = input.note?.trim() ?? "";
      if (noteRequirement === "required" && !note) {
        return { ok: false, error: "note_required" };
      }

      const completedAt = now();
      if (attachments.length) {
        await db.collection<AttachmentRecord>(WORK_ATTACHMENTS).insertMany(
          attachments.map((file) => ({
            _id: randomUUID(),
            workId: work._id,
            fileName: file.fileName,
            contentType: file.contentType,
            dataBase64: file.dataBase64,
            uploadedByAccountId: session.accountId,
            uploadedByDisplayName: session.displayName,
            uploadedAt: completedAt,
          })),
        );
      }

      await db.collection<WorkRecord>(WORKS).updateOne(
        { _id: work._id },
        {
          $set: {
            status: "completed",
            completedByAccountId: session.accountId,
            completedByDisplayName: session.displayName,
            completedAt,
            completionNote: note || null,
            updatedAt: completedAt,
          },
        },
      );

      await appendWorkAudit({
        workId: work._id,
        action: "complete",
        actorAccountId: session.accountId,
        actorDisplayName: session.displayName,
        fromStatus: "pending",
        toStatus: "completed",
        at: completedAt,
      });

      return { ok: true };
    },

    async cancelOwnCompletion(sessionId, input) {
      const session = await getSession(sessionId);
      if (!session) {
        return { ok: false, error: "unauthenticated" };
      }
      if (session.role === "personal" && !session.fixedUnit) {
        return { ok: false, error: "fixed_unit_required" };
      }

      const work = await db
        .collection<WorkRecord>(WORKS)
        .findOne({ _id: input.workId });
      if (!work || work.status === "cancelled") {
        return { ok: false, error: "not_found" };
      }
      if (session.role === "personal" && work.unit !== session.fixedUnit) {
        return { ok: false, error: "forbidden" };
      }
      if (work.type === "daily_settlement") {
        return { ok: false, error: "reserved_for_part2" };
      }
      if (work.status !== "completed") {
        return { ok: false, error: "not_completed" };
      }
      if (work.completedByAccountId !== session.accountId) {
        return { ok: false, error: "not_completer" };
      }

      const cancelledAt = now();
      await db.collection<WorkRecord>(WORKS).updateOne(
        { _id: work._id },
        {
          $set: {
            status: "pending",
            completedByAccountId: null,
            completedByDisplayName: null,
            completedAt: null,
            updatedAt: cancelledAt,
          },
        },
      );

      await appendWorkAudit({
        workId: work._id,
        action: "cancel_completion",
        actorAccountId: session.accountId,
        actorDisplayName: session.displayName,
        fromStatus: "completed",
        toStatus: "pending",
        at: cancelledAt,
      });

      return { ok: true };
    },

    async listWorkAudit(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) {
        return auth;
      }

      const entries = await db
        .collection<WorkAuditRecord>(WORK_AUDITS)
        .find({ workId: input.workId })
        .sort({ at: 1 })
        .toArray();

      return {
        ok: true,
        entries: entries.map((entry) => ({
          id: entry._id,
          workId: entry.workId,
          action: entry.action,
          actorAccountId: entry.actorAccountId,
          actorDisplayName: entry.actorDisplayName,
          fromStatus: entry.fromStatus,
          toStatus: entry.toStatus,
          at: entry.at,
        })),
      };
    },

    async createRecurringTemplate(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) {
        return auth;
      }
      if (!input.units.length) {
        return { ok: false, error: "units_required" };
      }
      if (input.units.some((unit) => !isFixedUnit(unit))) {
        return { ok: false, error: "invalid_unit" };
      }

      const template: RecurringTemplateRecord = {
        _id: randomUUID(),
        title: input.title.trim(),
        content: input.content.trim(),
        units: [...new Set(input.units)],
        priority: input.priority,
        recurrence: input.recurrence,
        sortOrder: input.sortOrder ?? 0,
        active: true,
        attachmentRequirement: input.attachmentRequirement ?? "none",
        noteRequirement: input.noteRequirement ?? "optional",
        sensitive: input.sensitive ?? false,
        createdByAccountId: auth.session.accountId,
        createdAt: now(),
        updatedAt: now(),
      };
      await db
        .collection<RecurringTemplateRecord>(RECURRING_TEMPLATES)
        .insertOne(template);

      return { ok: true, template: toTemplateView(template) };
    },

    async generateRecurringForDate(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) {
        return auth;
      }

      const createdCount = await generateRecurringForDateInternal(input.date);
      return { ok: true, createdCount };
    },

    async createDailySettlementWork(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) {
        return auth;
      }

      const works: WorkRecord[] = STORE_UNITS.map((unit) => ({
        _id: randomUUID(),
        type: "daily_settlement",
        title: input.title.trim(),
        content: input.content.trim(),
        unit,
        priority: input.priority,
        status: "pending",
        startAt: now(),
        dueAt: dueAtOnHongKongDate(now()),
        templateId: null,
        settlementState: "awaiting_part2",
        attachmentRequirement: "none",
        noteRequirement: "optional",
        completionNote: null,
        sensitive: false,
        completedByAccountId: null,
        completedByDisplayName: null,
        completedAt: null,
        createdByAccountId: auth.session.accountId,
        createdAt: now(),
        updatedAt: now(),
      }));

      await db.collection<WorkRecord>(WORKS).insertMany(works);
      return { ok: true, works: works.map(toWorkView) };
    },

    async listUnitProgress(sessionId) {
      const session = await getSession(sessionId);
      if (!session) {
        return { ok: false, error: "unauthenticated" };
      }

      const today = now();
      const all = await listTodayWorkRecords({
        hideSensitiveFor: session.role === "personal" ? session : null,
      });
      const units = FIXED_UNITS.map((unit) => {
        const works = all
          .filter((work) => work.unit === unit)
          .map(toWorkView);
        return { unit, ...summarizeWorks(works, today) };
      });

      return {
        ok: true,
        units,
        readOnlyNotice: CROSS_UNIT_READONLY_NOTICE,
      };
    },

    async getUnitWorkReadonly(sessionId, input) {
      const session = await getSession(sessionId);
      if (!session) {
        return { ok: false, error: "unauthenticated" };
      }
      if (!isFixedUnit(input.unit)) {
        return { ok: false, error: "invalid_unit" };
      }

      const today = now();
      const records = await listTodayWorkRecords({
        unit: input.unit,
        hideSensitiveFor: session.role === "personal" ? session : null,
      });
      const works = records.map(toReadonlyWorkView);
      return {
        ok: true,
        unit: input.unit,
        works,
        summary: summarizeWorks(records.map(toWorkView), today),
        readOnlyNotice: CROSS_UNIT_READONLY_NOTICE,
      };
    },

    async getWork(sessionId, input) {
      const session = await getSession(sessionId);
      if (!session) {
        return { ok: false, error: "unauthenticated" };
      }
      const work = await db
        .collection<WorkRecord>(WORKS)
        .findOne({ _id: input.workId });
      if (!work || work.status === "cancelled") {
        return { ok: false, error: "not_found" };
      }
      const canView =
        session.role === "manager" ||
        session.role === "system_admin" ||
        (session.role === "personal" && session.fixedUnit === work.unit);
      if (!canView) {
        return { ok: false, error: "forbidden" };
      }
      return { ok: true, work: toWorkView(work) };
    },

    async listWorkAttachments(sessionId, input) {
      const session = await getSession(sessionId);
      if (!session) {
        return { ok: false, error: "unauthenticated" };
      }
      const work = await db
        .collection<WorkRecord>(WORKS)
        .findOne({ _id: input.workId });
      if (!work) {
        return { ok: false, error: "not_found" };
      }
      const canView =
        session.role === "manager" ||
        session.role === "system_admin" ||
        (session.role === "personal" && session.fixedUnit === work.unit);
      if (!canView) {
        return { ok: false, error: "forbidden" };
      }

      const attachments = await db
        .collection<AttachmentRecord>(WORK_ATTACHMENTS)
        .find({ workId: input.workId })
        .sort({ uploadedAt: 1 })
        .toArray();

      return {
        ok: true,
        attachments: attachments.map((file) => ({
          id: file._id,
          workId: file.workId,
          fileName: file.fileName,
          contentType: file.contentType,
          dataBase64: file.dataBase64,
          uploadedByDisplayName: file.uploadedByDisplayName,
          uploadedAt: file.uploadedAt,
        })),
      };
    },

    async listCompletionHistory(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) return auth;
      const history = await db
        .collection(COMPLETION_HISTORY)
        .find({ workId: input.workId })
        .sort({ reopenedAt: -1 })
        .toArray();
      return {
        ok: true,
        history: history.map((row) => ({
          id: String(row._id),
          workId: String(row.workId),
          completedByAccountId: (row.completedByAccountId as string) ?? null,
          completedByDisplayName:
            (row.completedByDisplayName as string) ?? null,
          completedAt: (row.completedAt as Date) ?? null,
          completionNote: (row.completionNote as string) ?? null,
          reopenedAt: row.reopenedAt as Date,
          reopenedByDisplayName: String(row.reopenedByDisplayName),
          reason: String(row.reason),
        })),
      };
    },

    async reopenWork(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) return auth;
      const work = await db
        .collection<WorkRecord>(WORKS)
        .findOne({ _id: input.workId });
      if (!work || work.status === "cancelled") {
        return { ok: false, error: "not_found" };
      }
      if (work.status !== "completed") {
        return { ok: false, error: "not_completed" };
      }
      const at = now();
      await db.collection<CompletionHistoryRecord>(COMPLETION_HISTORY).insertOne({
        _id: randomUUID(),
        workId: work._id,
        completedByAccountId: work.completedByAccountId,
        completedByDisplayName: work.completedByDisplayName,
        completedAt: work.completedAt,
        completionNote: work.completionNote,
        reopenedAt: at,
        reopenedByAccountId: auth.session.accountId,
        reopenedByDisplayName: auth.session.displayName,
        reason: input.reason.trim(),
      });
      await db.collection<WorkRecord>(WORKS).updateOne(
        { _id: work._id },
        {
          $set: {
            status: "pending",
            completedByAccountId: null,
            completedByDisplayName: null,
            completedAt: null,
            completionNote: null,
            updatedAt: at,
          },
        },
      );
      await appendWorkAudit({
        workId: work._id,
        action: "reopen",
        actorAccountId: auth.session.accountId,
        actorDisplayName: auth.session.displayName,
        fromStatus: "completed",
        toStatus: "pending",
        at,
        reason: input.reason.trim(),
      });
      return { ok: true };
    },

    async updateWork(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) return auth;
      const work = await db
        .collection<WorkRecord>(WORKS)
        .findOne({ _id: input.workId });
      if (!work || work.status === "cancelled") {
        return { ok: false, error: "not_found" };
      }

      const updates: Partial<WorkRecord> = { updatedAt: now() };
      const logs: WorkChangeLogRecord[] = [];
      const track = (field: string, before: string, after: string) => {
        if (before === after) return;
        logs.push({
          _id: randomUUID(),
          workId: work._id,
          field,
          before,
          after,
          changedByAccountId: auth.session.accountId,
          changedByDisplayName: auth.session.displayName,
          changedAt: now(),
        });
      };

      if (input.title !== undefined) {
        track("title", work.title, input.title.trim());
        updates.title = input.title.trim();
      }
      if (input.content !== undefined) {
        track("content", work.content, input.content.trim());
        updates.content = input.content.trim();
      }
      if (input.priority !== undefined) {
        track("priority", work.priority, input.priority);
        updates.priority = input.priority;
      }
      if (input.attachmentRequirement !== undefined) {
        track(
          "attachmentRequirement",
          work.attachmentRequirement ?? "none",
          input.attachmentRequirement,
        );
        updates.attachmentRequirement = input.attachmentRequirement;
      }
      if (input.noteRequirement !== undefined) {
        track(
          "noteRequirement",
          work.noteRequirement ?? "optional",
          input.noteRequirement,
        );
        updates.noteRequirement = input.noteRequirement;
      }
      if (input.sensitive !== undefined) {
        track("sensitive", String(work.sensitive ?? false), String(input.sensitive));
        updates.sensitive = input.sensitive;
      }

      await db.collection<WorkRecord>(WORKS).updateOne(
        { _id: work._id },
        { $set: updates },
      );
      if (logs.length) {
        await db.collection<WorkChangeLogRecord>(WORK_CHANGE_LOGS).insertMany(logs);
      }
      return { ok: true };
    },

    async cancelAdhocWork(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) return auth;
      const work = await db
        .collection<WorkRecord>(WORKS)
        .findOne({ _id: input.workId });
      if (!work) return { ok: false, error: "not_found" };
      if (work.type !== "adhoc") return { ok: false, error: "not_adhoc" };
      await db.collection<WorkRecord>(WORKS).updateOne(
        { _id: work._id },
        { $set: { status: "cancelled", updatedAt: now() } },
      );
      return { ok: true };
    },

    async listRecurringTemplates(actorSessionId) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) return auth;
      const templates = await db
        .collection<RecurringTemplateRecord>(RECURRING_TEMPLATES)
        .find({})
        .sort({ sortOrder: 1, createdAt: 1 })
        .toArray();
      return { ok: true, templates: templates.map(toTemplateView) };
    },

    async deactivateRecurringTemplate(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) return auth;
      const result = await db
        .collection<RecurringTemplateRecord>(RECURRING_TEMPLATES)
        .updateOne(
          { _id: input.templateId },
          { $set: { active: false, updatedAt: now() } },
        );
      if (result.matchedCount === 0) return { ok: false, error: "not_found" };
      return { ok: true };
    },

    async listWorkChangeLogs(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) return auth;
      const logs = await db
        .collection<WorkChangeLogRecord>(WORK_CHANGE_LOGS)
        .find({ workId: input.workId })
        .sort({ changedAt: 1 })
        .toArray();
      return {
        ok: true,
        logs: logs.map((log) => ({
          id: log._id,
          workId: log.workId,
          field: log.field,
          before: log.before,
          after: log.after,
          changedByDisplayName: log.changedByDisplayName,
          changedAt: log.changedAt,
        })),
      };
    },

    async listMyCompletions(sessionId, input = {}) {
      const session = await getSession(sessionId);
      if (!session) {
        return { ok: false, error: "unauthenticated" };
      }
      if (session.role !== "personal") {
        return { ok: false, error: "forbidden" };
      }

      const filter: Record<string, unknown> = {
        status: "completed",
        completedByAccountId: session.accountId,
      };
      if (input.from || input.to) {
        filter.completedAt = {
          ...(input.from ? { $gte: input.from } : {}),
          ...(input.to ? { $lte: input.to } : {}),
        };
      }

      const works = await db
        .collection<WorkRecord>(WORKS)
        .find(filter)
        .sort({ completedAt: -1 })
        .toArray();

      return {
        ok: true,
        completions: works
          .filter((work) => work.completedAt)
          .map((work) => ({
            id: work._id,
            title: work.title,
            unit: work.unit,
            completedAt: work.completedAt!,
            dueAt: work.dueAt,
            onTime:
              !work.dueAt ||
              work.completedAt!.getTime() <= work.dueAt.getTime(),
          })),
      };
    },

    async searchWorkHistory(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) return auth;
      return { ok: true, works: await searchWorkHistoryInternal(input) };
    },

    async getStaffStats(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) return auth;
      const filter: Record<string, unknown> = {
        status: "completed",
        completedByAccountId: { $ne: null },
      };
      if (input.unit) filter.unit = input.unit;
      if (input.from || input.to) {
        filter.completedAt = {
          ...(input.from ? { $gte: input.from } : {}),
          ...(input.to ? { $lte: input.to } : {}),
        };
      }
      const works = await db.collection<WorkRecord>(WORKS).find(filter).toArray();
      const map = new Map<string, StaffStatView>();
      for (const work of works) {
        if (!work.completedByAccountId) continue;
        const current = map.get(work.completedByAccountId) ?? {
          accountId: work.completedByAccountId,
          displayName: work.completedByDisplayName ?? "未知",
          completedCount: 0,
          overdueCompletedCount: 0,
        };
        current.completedCount += 1;
        if (
          work.dueAt &&
          work.completedAt &&
          work.completedAt.getTime() > work.dueAt.getTime()
        ) {
          current.overdueCompletedCount += 1;
        }
        map.set(work.completedByAccountId, current);
      }
      return { ok: true, stats: [...map.values()] };
    },

    async exportWorkHistoryCsv(actorSessionId, input) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) return auth;
      const works = await searchWorkHistoryInternal(input);
      const header = [
        "title",
        "unit",
        "type",
        "status",
        "priority",
        "completedBy",
        "completedAt",
      ];
      const rows = works.map((work) =>
        [
          work.title,
          work.unit,
          work.type,
          work.status,
          work.priority,
          work.completedByDisplayName ?? "",
          work.completedAt?.toISOString() ?? "",
        ]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      );
      return { ok: true, csv: [header.join(","), ...rows].join("\n") };
    },

    async seedDemoRecurringTemplates(actorSessionId) {
      const auth = await requireManager(actorSessionId);
      if (!auth.ok) return auth;

      const demos: Array<{
        title: string;
        content: string;
        units: FixedUnit[];
      }> = [
        {
          title: "每日開舖檢查",
          content: "檢查門鎖、燈光與店面安全",
          units: [...STORE_UNITS],
        },
        {
          title: "清潔指定位置",
          content: "清潔門市指定區域",
          units: [...STORE_UNITS],
        },
        {
          title: "檢查貨品存量",
          content: "檢查門市貨品存量",
          units: [...STORE_UNITS],
        },
        {
          title: "倉庫環境檢查",
          content: "檢查國內倉庫環境與安全",
          units: ["國內倉"],
        },
        {
          title: "貨物收貨",
          content: "處理國內倉收貨流程",
          units: ["國內倉"],
        },
        {
          title: "倉庫清潔",
          content: "清潔國內倉指定區域",
          units: ["國內倉"],
        },
      ];

      let createdCount = 0;
      for (const demo of demos) {
        const existing = await db
          .collection<RecurringTemplateRecord>(RECURRING_TEMPLATES)
          .findOne({ title: demo.title, active: true });
        if (existing) continue;

        const template: RecurringTemplateRecord = {
          _id: randomUUID(),
          title: demo.title,
          content: demo.content,
          units: demo.units,
          priority: "normal",
          recurrence: "daily",
          sortOrder: createdCount + 1,
          active: true,
          attachmentRequirement: "none",
          noteRequirement: "optional",
          sensitive: false,
          createdByAccountId: auth.session.accountId,
          createdAt: now(),
          updatedAt: now(),
        };
        await db
          .collection<RecurringTemplateRecord>(RECURRING_TEMPLATES)
          .insertOne(template);
        createdCount += 1;
      }
      return { ok: true, createdCount };
    },
  } satisfies StoreWorkFlowApp;
}

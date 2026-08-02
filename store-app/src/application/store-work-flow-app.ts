import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Db } from "mongodb";

export type AccountRole = "personal" | "manager" | "system_admin";

export const FIXED_UNITS = [
  "觀塘",
  "荔枝角",
  "灣仔",
  "屯門",
  "國內倉",
] as const;

export type FixedUnit = (typeof FIXED_UNITS)[number];

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
  completedByAccountId: string | null;
  completedByDisplayName: string | null;
  completedAt: Date | null;
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
  action: "complete" | "cancel_completion";
  actorAccountId: string;
  actorDisplayName: string;
  fromStatus: WorkStatus;
  toStatus: WorkStatus;
  at: Date;
};

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
  completedByAccountId: string | null;
  completedByDisplayName: string | null;
  completedAt: Date | null;
  createdByAccountId: string;
  createdAt: Date;
};

type WorkAuditRecord = {
  _id: string;
  workId: string;
  action: "complete" | "cancel_completion";
  actorAccountId: string;
  actorDisplayName: string;
  fromStatus: WorkStatus;
  toStatus: WorkStatus;
  at: Date;
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
    input: { workId: string },
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        error:
          | AuthError
          | "not_found"
          | "already_completed"
          | "fixed_unit_required";
      }
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
          | "fixed_unit_required";
      }
  >;
  listWorkAudit(
    actorSessionId: string,
    input: { workId: string },
  ): Promise<
    | { ok: true; entries: WorkAuditView[] }
    | { ok: false; error: AuthError }
  >;
};

const ACCOUNTS = "accounts";
const SESSIONS = "sessions";
const UNIT_CHANGE_LOGS = "unit_change_logs";
const WORKS = "work_instances";
const WORK_AUDITS = "work_audits";

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
    completedByAccountId: work.completedByAccountId,
    completedByDisplayName: work.completedByDisplayName,
    completedAt: work.completedAt,
  };
}

function summarizeWorks(works: WorkView[]): TodayWorkSummary {
  const total = works.length;
  const completed = works.filter((work) => work.status === "completed").length;
  const pending = works.filter((work) => work.status === "pending").length;
  const now = Date.now();
  const overdue = works.filter(
    (work) =>
      work.status === "pending" &&
      work.dueAt !== null &&
      work.dueAt.getTime() < now,
  ).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { total, completed, pending, overdue, percent };
}

export function createStoreWorkFlowApp(deps: { db: Db }): StoreWorkFlowApp {
  const { db } = deps;

  async function getSession(sessionId: string): Promise<Session | null> {
    const session = await db
      .collection<SessionRecord>(SESSIONS)
      .findOne({ _id: sessionId });
    if (!session) {
      return null;
    }

    const account = await db
      .collection<AccountRecord>(ACCOUNTS)
      .findOne({ _id: session.accountId });
    if (!account || account.status !== "active") {
      return null;
    }

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
      ...entry,
    });
  }

  return {
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
      const session: SessionRecord = {
        _id: sessionId,
        accountId: account._id,
        createdAt: new Date(),
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
        completedByAccountId: null,
        completedByDisplayName: null,
        completedAt: null,
        createdByAccountId: auth.session.accountId,
        createdAt: new Date(),
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
      if (session.role === "personal") {
        if (!session.fixedUnit) {
          return { ok: false, error: "fixed_unit_required" };
        }

        const works = (
          await db
            .collection<WorkRecord>(WORKS)
            .find({
              unit: session.fixedUnit,
              status: { $in: ["pending", "completed"] },
              type: { $in: ["adhoc", "recurring", "daily_settlement"] },
            })
            .sort({ dueAt: 1, createdAt: 1 })
            .toArray()
        ).map(toWorkView);

        return { ok: true, works, summary: summarizeWorks(works) };
      }

      const works = (
        await db
          .collection<WorkRecord>(WORKS)
          .find({ status: { $in: ["pending", "completed"] } })
          .sort({ unit: 1, dueAt: 1, createdAt: 1 })
          .toArray()
      ).map(toWorkView);

      return { ok: true, works, summary: summarizeWorks(works) };
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
      if (work.status === "completed") {
        return { ok: false, error: "already_completed" };
      }

      await db.collection<WorkRecord>(WORKS).updateOne(
        { _id: work._id },
        {
          $set: {
            status: "completed",
            completedByAccountId: session.accountId,
            completedByDisplayName: session.displayName,
            completedAt: new Date(),
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
        at: new Date(),
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
      if (work.status !== "completed") {
        return { ok: false, error: "not_completed" };
      }
      if (work.completedByAccountId !== session.accountId) {
        return { ok: false, error: "not_completer" };
      }

      await db.collection<WorkRecord>(WORKS).updateOne(
        { _id: work._id },
        {
          $set: {
            status: "pending",
            completedByAccountId: null,
            completedByDisplayName: null,
            completedAt: null,
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
        at: new Date(),
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
  };
}

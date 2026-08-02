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
};

const ACCOUNTS = "accounts";
const SESSIONS = "sessions";
const UNIT_CHANGE_LOGS = "unit_change_logs";

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
  };
}

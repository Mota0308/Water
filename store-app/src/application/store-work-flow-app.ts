import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Db } from "mongodb";

export type AccountRole = "personal" | "manager" | "system_admin";

export type Session = {
  sessionId: string;
  accountId: string;
  loginName: string;
  displayName: string;
  role: AccountRole;
};

type AccountRecord = {
  _id: string;
  loginName: string;
  displayName: string;
  passwordHash: string;
  role: AccountRole;
  status: "active" | "suspended";
  createdAt: Date;
};

type SessionRecord = {
  _id: string;
  accountId: string;
  createdAt: Date;
};

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
};

const ACCOUNTS = "accounts";
const SESSIONS = "sessions";

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
    };
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
        status: "active",
        createdAt: new Date(),
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
  };
}

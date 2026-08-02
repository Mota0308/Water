import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createStoreWorkFlowApp } from "./store-work-flow-app";

describe("門市工作流程應用服務 — 登入與會話", () => {
  let memoryServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeEach(async () => {
    memoryServer = await MongoMemoryServer.create();
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    db = client.db("store-work-flow-test");
  });

  afterEach(async () => {
    await client.close();
    await memoryServer.stop();
  });

  it("系統管理員種子後可用正確密碼登入並取得會話", async () => {
    const app = createStoreWorkFlowApp({ db });

    await app.seedSystemAdmin({
      loginName: "admin",
      password: "Secret123!",
      displayName: "系統管理員",
    });

    const login = await app.login({
      loginName: "admin",
      password: "Secret123!",
    });

    expect(login).toEqual({
      ok: true,
      sessionId: expect.any(String),
    });

    if (!login.ok) {
      throw new Error("expected login to succeed");
    }

    const session = await app.getSession(login.sessionId);
    expect(session).toMatchObject({
      loginName: "admin",
      displayName: "系統管理員",
      role: "system_admin",
    });
  });

  it("錯誤密碼無法登入", async () => {
    const app = createStoreWorkFlowApp({ db });

    await app.seedSystemAdmin({
      loginName: "admin",
      password: "Secret123!",
      displayName: "系統管理員",
    });

    const login = await app.login({
      loginName: "admin",
      password: "wrong-password",
    });

    expect(login).toEqual({
      ok: false,
      error: "invalid_credentials",
    });
  });

  it("登出後會話失效", async () => {
    const app = createStoreWorkFlowApp({ db });

    await app.seedSystemAdmin({
      loginName: "admin",
      password: "Secret123!",
      displayName: "系統管理員",
    });

    const login = await app.login({
      loginName: "admin",
      password: "Secret123!",
    });

    if (!login.ok) {
      throw new Error("expected login to succeed");
    }

    await app.logout(login.sessionId);

    const session = await app.getSession(login.sessionId);
    expect(session).toBeNull();
  });

  it("未登入時 requireSession 拒絕存取", async () => {
    const app = createStoreWorkFlowApp({ db });

    const result = await app.requireSession(null);

    expect(result).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });

  it("登出後或未知 sessionId 時 requireSession 拒絕存取", async () => {
    const app = createStoreWorkFlowApp({ db });

    await app.seedSystemAdmin({
      loginName: "admin",
      password: "Secret123!",
      displayName: "系統管理員",
    });

    const login = await app.login({
      loginName: "admin",
      password: "Secret123!",
    });

    if (!login.ok) {
      throw new Error("expected login to succeed");
    }

    await app.logout(login.sessionId);

    const afterLogout = await app.requireSession(login.sessionId);
    expect(afterLogout).toEqual({
      ok: false,
      error: "unauthenticated",
    });

    const unknown = await app.requireSession("not-a-real-session");
    expect(unknown).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });
});

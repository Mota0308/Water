import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createStoreWorkFlowApp } from "./store-work-flow-app";

const ADMIN = {
  loginName: "admin",
  password: "Secret123!",
  displayName: "系統管理員",
};

async function setupAdmin(db: Db) {
  const app = createStoreWorkFlowApp({ db });
  await app.seedSystemAdmin(ADMIN);
  const login = await app.login(ADMIN);
  if (!login.ok) {
    throw new Error("admin login failed");
  }
  return { app, adminSessionId: login.sessionId };
}

describe("門市工作流程應用服務 — 賬號治理", () => {
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

  it("系統管理員可建立個人賬號並設定固定單位", async () => {
    const { app, adminSessionId } = await setupAdmin(db);

    const created = await app.createAccount(adminSessionId, {
      loginName: "kt.staff",
      password: "Staff123!",
      displayName: "觀塘同事",
      role: "personal",
      fixedUnit: "觀塘",
      jobTitle: "店務",
    });

    expect(created).toMatchObject({
      ok: true,
      account: {
        loginName: "kt.staff",
        displayName: "觀塘同事",
        role: "personal",
        fixedUnit: "觀塘",
        jobTitle: "店務",
        status: "active",
      },
    });

    const login = await app.login({
      loginName: "kt.staff",
      password: "Staff123!",
    });
    expect(login.ok).toBe(true);
    if (!login.ok) return;

    const session = await app.getSession(login.sessionId);
    expect(session).toMatchObject({
      role: "personal",
      fixedUnit: "觀塘",
      displayName: "觀塘同事",
    });
  });

  it("固定單位只能是五個合法單位", async () => {
    const { app, adminSessionId } = await setupAdmin(db);

    const created = await app.createAccount(adminSessionId, {
      loginName: "bad.unit",
      password: "Staff123!",
      displayName: "錯誤單位",
      role: "personal",
      fixedUnit: "尖沙咀" as "觀塘",
    });

    expect(created).toEqual({
      ok: false,
      error: "invalid_unit",
    });
  });

  it("個人賬號必須有固定單位；管理層可不設", async () => {
    const { app, adminSessionId } = await setupAdmin(db);

    const personalMissingUnit = await app.createAccount(adminSessionId, {
      loginName: "no.unit",
      password: "Staff123!",
      displayName: "缺單位",
      role: "personal",
    });
    expect(personalMissingUnit).toEqual({
      ok: false,
      error: "fixed_unit_required",
    });

    const manager = await app.createAccount(adminSessionId, {
      loginName: "manager.one",
      password: "Manager123!",
      displayName: "一般管理",
      role: "manager",
    });
    expect(manager).toMatchObject({
      ok: true,
      account: { role: "manager", fixedUnit: null },
    });
  });

  it("個人可驗證舊密碼後自行改密；錯誤舊密碼被拒", async () => {
    const { app, adminSessionId } = await setupAdmin(db);
    await app.createAccount(adminSessionId, {
      loginName: "kt.staff",
      password: "Staff123!",
      displayName: "觀塘同事",
      role: "personal",
      fixedUnit: "觀塘",
    });

    const login = await app.login({
      loginName: "kt.staff",
      password: "Staff123!",
    });
    if (!login.ok) throw new Error("login failed");

    const wrong = await app.changeOwnPassword(login.sessionId, {
      oldPassword: "wrong",
      newPassword: "NewStaff123!",
    });
    expect(wrong).toEqual({ ok: false, error: "invalid_credentials" });

    const changed = await app.changeOwnPassword(login.sessionId, {
      oldPassword: "Staff123!",
      newPassword: "NewStaff123!",
    });
    expect(changed).toEqual({ ok: true });

    const relogin = await app.login({
      loginName: "kt.staff",
      password: "NewStaff123!",
    });
    expect(relogin.ok).toBe(true);
  });

  it("系統管理員可重設密碼、暫停與重新啟用；停用後無法登入", async () => {
    const { app, adminSessionId } = await setupAdmin(db);
    const created = await app.createAccount(adminSessionId, {
      loginName: "kt.staff",
      password: "Staff123!",
      displayName: "觀塘同事",
      role: "personal",
      fixedUnit: "觀塘",
    });
    if (!created.ok) throw new Error("create failed");

    const reset = await app.resetPassword(adminSessionId, {
      accountId: created.account.id,
      newPassword: "Reset123!",
    });
    expect(reset).toEqual({ ok: true });

    expect(
      (
        await app.login({
          loginName: "kt.staff",
          password: "Reset123!",
        })
      ).ok,
    ).toBe(true);

    const suspended = await app.setAccountStatus(adminSessionId, {
      accountId: created.account.id,
      status: "suspended",
    });
    expect(suspended).toEqual({ ok: true });

    expect(
      await app.login({
        loginName: "kt.staff",
        password: "Reset123!",
      }),
    ).toEqual({ ok: false, error: "invalid_credentials" });

    await app.setAccountStatus(adminSessionId, {
      accountId: created.account.id,
      status: "active",
    });
    expect(
      (
        await app.login({
          loginName: "kt.staff",
          password: "Reset123!",
        })
      ).ok,
    ).toBe(true);
  });

  it("更改固定單位立即生效並留下紀錄", async () => {
    const { app, adminSessionId } = await setupAdmin(db);
    const created = await app.createAccount(adminSessionId, {
      loginName: "kt.staff",
      password: "Staff123!",
      displayName: "觀塘同事",
      role: "personal",
      fixedUnit: "觀塘",
    });
    if (!created.ok) throw new Error("create failed");

    const changed = await app.changeFixedUnit(adminSessionId, {
      accountId: created.account.id,
      fixedUnit: "屯門",
      reason: "調職",
    });
    expect(changed).toEqual({ ok: true });

    const login = await app.login({
      loginName: "kt.staff",
      password: "Staff123!",
    });
    if (!login.ok) throw new Error("login failed");
    const session = await app.getSession(login.sessionId);
    expect(session?.fixedUnit).toBe("屯門");

    const history = await app.listUnitChangeLogs(adminSessionId, {
      accountId: created.account.id,
    });
    expect(history).toMatchObject({
      ok: true,
      logs: [
        {
          accountId: created.account.id,
          fromUnit: "觀塘",
          toUnit: "屯門",
          reason: "調職",
          changedByLoginName: "admin",
        },
      ],
    });
  });

  it("調職只改賬號單位，不搬動其他單位工作集合資料", async () => {
    const { app, adminSessionId } = await setupAdmin(db);
    const created = await app.createAccount(adminSessionId, {
      loginName: "kt.staff",
      password: "Staff123!",
      displayName: "觀塘同事",
      role: "personal",
      fixedUnit: "觀塘",
    });
    if (!created.ok) throw new Error("create failed");

    await db.collection("work_instances").insertOne({
      unit: "觀塘",
      title: "開舖檢查",
    });

    await app.changeFixedUnit(adminSessionId, {
      accountId: created.account.id,
      fixedUnit: "灣仔",
    });

    const work = await db
      .collection("work_instances")
      .findOne({ title: "開舖檢查" });
    expect(work).toMatchObject({ unit: "觀塘" });
  });

  it("一般管理層無法執行賬號治理", async () => {
    const { app, adminSessionId } = await setupAdmin(db);
    const managerCreated = await app.createAccount(adminSessionId, {
      loginName: "manager.one",
      password: "Manager123!",
      displayName: "一般管理",
      role: "manager",
    });
    if (!managerCreated.ok) throw new Error("create manager failed");

    const managerLogin = await app.login({
      loginName: "manager.one",
      password: "Manager123!",
    });
    if (!managerLogin.ok) throw new Error("manager login failed");

    const denied = await app.createAccount(managerLogin.sessionId, {
      loginName: "another",
      password: "Staff123!",
      displayName: "不該成功",
      role: "personal",
      fixedUnit: "觀塘",
    });
    expect(denied).toEqual({ ok: false, error: "forbidden" });

    const resetDenied = await app.resetPassword(managerLogin.sessionId, {
      accountId: managerCreated.account.id,
      newPassword: "Nope123!",
    });
    expect(resetDenied).toEqual({ ok: false, error: "forbidden" });
  });
});

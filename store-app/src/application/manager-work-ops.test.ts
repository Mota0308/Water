import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createStoreWorkFlowApp } from "./store-work-flow-app";

async function boot(db: Db) {
  const app = createStoreWorkFlowApp({ db });
  await app.seedSystemAdmin({
    loginName: "admin",
    password: "Secret123!",
    displayName: "系統管理員",
  });
  const adminLogin = await app.login({
    loginName: "admin",
    password: "Secret123!",
  });
  if (!adminLogin.ok) throw new Error("admin");
  await app.createAccount(adminLogin.sessionId, {
    loginName: "manager.one",
    password: "Manager123!",
    displayName: "一般管理",
    role: "manager",
  });
  await app.createAccount(adminLogin.sessionId, {
    loginName: "kt.a",
    password: "Staff123!",
    displayName: "觀塘甲",
    role: "personal",
    fixedUnit: "觀塘",
  });
  const managerLogin = await app.login({
    loginName: "manager.one",
    password: "Manager123!",
  });
  if (!managerLogin.ok) throw new Error("manager");
  return {
    app,
    adminSessionId: adminLogin.sessionId,
    managerSessionId: managerLogin.sessionId,
  };
}

describe("門市工作流程應用服務 — 管理層工作操作", () => {
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

  it("管理層可重新開啟、編輯留痕、取消突發與停用恆常；個人不可", async () => {
    const { app, managerSessionId } = await boot(db);
    const created = await app.createAdhocWork(managerSessionId, {
      title: "臨時點算",
      content: "舊內容",
      units: ["觀塘"],
      priority: "normal",
    });
    if (!created.ok) throw new Error("create");
    const workId = created.works[0]!.id;

    const kt = await app.login({ loginName: "kt.a", password: "Staff123!" });
    if (!kt.ok) throw new Error("kt");
    await app.completeWork(kt.sessionId, { workId });

    expect(
      await app.reopenWork(kt.sessionId, { workId, reason: "誤點" }),
    ).toEqual({ ok: false, error: "forbidden" });

    expect(
      await app.reopenWork(managerSessionId, { workId, reason: "誤點需重做" }),
    ).toEqual({ ok: true });

    const afterReopen = await app.getTodayWork(kt.sessionId);
    expect(afterReopen).toMatchObject({
      ok: true,
      works: [expect.objectContaining({ id: workId, status: "pending" })],
    });

    const edited = await app.updateWork(managerSessionId, {
      workId,
      title: "臨時點算（更新）",
      content: "新內容",
    });
    expect(edited).toEqual({ ok: true });

    const changes = await app.listWorkChangeLogs(managerSessionId, { workId });
    expect(changes).toMatchObject({
      ok: true,
      logs: expect.arrayContaining([
        expect.objectContaining({
          field: "content",
          before: "舊內容",
          after: "新內容",
        }),
      ]),
    });

    expect(await app.cancelAdhocWork(managerSessionId, { workId })).toEqual({
      ok: true,
    });
    const today = await app.getTodayWork(kt.sessionId);
    expect(today).toMatchObject({ ok: true, works: [] });

    const template = await app.createRecurringTemplate(managerSessionId, {
      title: "每日開舖檢查",
      content: "檢查",
      units: ["觀塘"],
      priority: "normal",
      recurrence: "daily",
    });
    if (!template.ok) throw new Error("template");
    expect(
      await app.deactivateRecurringTemplate(managerSessionId, {
        templateId: template.template.id,
      }),
    ).toEqual({ ok: true });

    expect(
      await app.cancelAdhocWork(kt.sessionId, { workId }),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("一般管理層仍不可管賬號；系統管理員可以", async () => {
    const { app, adminSessionId, managerSessionId } = await boot(db);
    expect(
      await app.createAccount(managerSessionId, {
        loginName: "x",
        password: "Staff123!",
        displayName: "X",
        role: "personal",
        fixedUnit: "觀塘",
      }),
    ).toEqual({ ok: false, error: "forbidden" });

    expect(
      (
        await app.createAccount(adminSessionId, {
          loginName: "ok.staff",
          password: "Staff123!",
          displayName: "OK",
          role: "personal",
          fixedUnit: "灣仔",
        })
      ).ok,
    ).toBe(true);
  });
});
